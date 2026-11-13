import { createServer } from "node:http"

/** One server standing in for Dokploy (/api), GitHub (/gh) and Garage's S3 api (/s3), with just enough state to test the scripts. */
export async function startMock() {
  const s = {
    writes: [],
    apps: new Map(),
    pgs: new Map(),
    domains: new Map(),
    deployments: new Map(),
    volumes: new Set(),
    comments: [],
    ghDeployments: [],
    statuses: [],
    buckets: new Map(),
    pulls: new Map(),
    pullError: null, // status the pulls endpoint answers with, to test a failing github
    volumeError: new Set(), // volumes dokploy refuses to remove
    foreign: new Map(), // applications of another dokploy project, must never be deleted
    noProject: false, // the skiffr-previews project is not found
    tags: [],
    seq: 0,
  }
  const id = (prefix) => `${prefix}${++s.seq}`
  const json = (res, body, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify(body))
  }
  const empty = (res, status = 200) => {
    res.writeHead(status)
    res.end()
  }
  const project = () => ({
    projectId: "p1",
    name: "skiffr-previews",
    environments: [
      {
        environmentId: "e1",
        applications: [...s.apps.values()].map((a) => ({
          applicationId: a.applicationId,
          name: a.name,
          applicationStatus: "done",
        })),
        postgres: [...s.pgs.values()].map((p) => ({ postgresId: p.postgresId })),
      },
    ],
  })

  const dokployRoutes = {
    "GET project.all": (res) =>
      json(res, [
        {
          name: "skiffr",
          environments: [
            { environmentId: "e0", applications: [...s.foreign.values()].map((a) => ({ ...a })), postgres: [] },
          ],
        },
        ...(s.noProject ? [] : [project()]),
      ]),
    "POST application.create": (res, _q, body) => {
      const app = {
        applicationId: id("app"),
        name: body.name,
        appName: `${body.name}-x${s.seq}`,
        env: "",
        createdAt: new Date().toISOString(),
      }
      s.apps.set(app.applicationId, app)
      s.domains.set(app.applicationId, [])
      s.deployments.set(app.applicationId, [])
      json(res, app)
    },
    "GET application.one": (res, q) => json(res, s.apps.get(q.applicationId)),
    "POST application.saveDockerProvider": (res, _q, body) => {
      Object.assign(s.apps.get(body.applicationId), { dockerImage: body.dockerImage, registryUrl: body.registryUrl })
      json(res, {})
    },
    "POST application.saveEnvironment": (res, _q, body) => {
      s.apps.get(body.applicationId).env = body.env
      json(res, {})
    },
    "POST application.deploy": (res, _q, body) => {
      s.deployments
        .get(body.applicationId)
        .push({ deploymentId: id("dep"), status: "done", createdAt: new Date().toISOString() })
      json(res, {})
    },
    "POST application.delete": (res, _q, body) => {
      s.apps.delete(body.applicationId)
      s.foreign.delete(body.applicationId)
      json(res, {})
    },
    "GET deployment.all": (res, q) => json(res, s.deployments.get(q.applicationId) ?? []),
    "GET domain.byApplicationId": (res, q) => json(res, s.domains.get(q.applicationId) ?? []),
    "POST domain.create": (res, _q, body) => {
      s.domains.get(body.applicationId).push(body)
      json(res, {})
    },
    "POST postgres.create": (res, _q, body) => {
      const pg = { ...body, postgresId: id("pg"), appName: `${body.name}-y${s.seq}`, applicationStatus: "idle" }
      s.pgs.set(pg.postgresId, pg)
      s.volumes.add(`${pg.appName}-data`) // Dokploy mounts it and never removes it
      json(res, { postgresId: pg.postgresId })
    },
    "POST postgres.deploy": (res, _q, body) => {
      s.pgs.get(body.postgresId).applicationStatus = "done"
      json(res, {})
    },
    "GET postgres.one": (res, q) => json(res, s.pgs.get(q.postgresId)),
    "POST postgres.remove": (res, _q, body) => {
      s.pgs.delete(body.postgresId)
      json(res, {})
    },
    "GET dockerVolume.getVolumes": (res) =>
      json(res, [{ Name: "unrelated-data" }, ...[...s.volumes].map((Name) => ({ Name }))]),
    "POST dockerVolume.removeVolume": (res, _q, body) => {
      if (s.volumeError.has(body.volumeName)) return json(res, { message: "volume is in use" }, 500)
      s.volumes.delete(body.volumeName)
      json(res, {})
    },
  }

  function dokploy(method, path, query, body, res) {
    if (method !== "GET") s.writes.push(path)
    const route = dokployRoutes[`${method} ${path}`]
    if (!route) return json(res, { message: `no route ${path}` }, 404)
    return route(res, query, body)
  }

  function github(method, path, body, res) {
    if (method !== "GET") s.writes.push(`gh ${method} ${path}`)
    const comments = /^repos\/o\/r\/issues\/(\d+)\/comments/.exec(path)
    if (comments && method === "GET")
      return json(
        res,
        s.comments.filter((c) => c.pr === Number(comments[1])),
      )
    if (comments) {
      const comment = {
        id: s.comments.length + 1,
        pr: Number(comments[1]),
        body: body.body,
        user: { login: "github-actions[bot]" },
      }
      s.comments.push(comment)
      return json(res, comment)
    }
    const edit = /^repos\/o\/r\/issues\/comments\/(\d+)/.exec(path)
    if (edit) {
      s.comments.find((c) => c.id === Number(edit[1])).body = body.body
      return json(res, {})
    }
    if (path === "repos/o/r/deployments" && method === "POST") {
      const deployment = { id: s.ghDeployments.length + 1, ...body }
      s.ghDeployments.push(deployment)
      return json(res, deployment)
    }
    if (path.startsWith("repos/o/r/deployments?")) return json(res, s.ghDeployments)
    if (/^repos\/o\/r\/deployments\/\d+\/statuses/.test(path)) {
      s.statuses.push(body.state)
      return json(res, {})
    }
    if (path.startsWith("repos/o/r/actions/runs")) {
      return json(res, { workflow_runs: [{ name: "ci", html_url: "https://github.com/o/r/actions/runs/9" }] })
    }
    const pull = /^repos\/o\/r\/pulls\/(\d+)/.exec(path)
    if (pull) {
      if (s.pullError) return json(res, { message: "boom" }, s.pullError)
      const state = s.pulls.get(Number(pull[1]))
      return state ? json(res, { state }) : json(res, { message: "Not Found" }, 404)
    }
    if (/^users\/o\/packages\/container\/skiffr-api\/versions\?/.test(path)) return json(res, s.tags)
    const version = /^users\/o\/packages\/container\/skiffr-api\/versions\/(\d+)/.exec(path)
    if (version) {
      s.tags = s.tags.filter((t) => t.id !== Number(version[1]))
      return json(res, {})
    }
    if (path.startsWith("users/o/packages")) return json(res, [])
    return json(res, { message: `no route ${path}` }, 404)
  }

  function s3(method, pathname, res) {
    if (method !== "GET" && method !== "HEAD") s.writes.push(`s3 ${method} ${pathname}`)
    const [, bucket, ...rest] = pathname.split("/")
    const xml = (body) => {
      res.writeHead(200, { "content-type": "application/xml" })
      res.end(body)
    }
    if (!bucket) {
      const names = [...s.buckets.keys()].map((b) => `<Bucket><Name>${b}</Name></Bucket>`).join("")
      return xml(`<ListAllMyBucketsResult><Buckets>${names}</Buckets></ListAllMyBucketsResult>`)
    }
    if (method === "PUT") {
      if (s.buckets.has(bucket)) {
        res.writeHead(409)
        return res.end("<Error><Code>BucketAlreadyOwnedByYou</Code></Error>")
      }
      s.buckets.set(bucket, new Set())
      return empty(res)
    }
    if (!s.buckets.has(bucket)) return empty(res, 404)
    if (method === "HEAD") return empty(res)
    if (method === "GET") {
      const keys = [...s.buckets.get(bucket)].map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key></Contents>`)
      return xml(`<ListBucketResult><IsTruncated>false</IsTruncated>${keys.join("")}</ListBucketResult>`)
    }
    if (rest.length > 0) {
      s.buckets.get(bucket).delete(decodeURIComponent(rest.join("/")))
      return empty(res, 204)
    }
    if (s.buckets.get(bucket).size > 0) return empty(res, 409)
    s.buckets.delete(bucket)
    return empty(res, 204)
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost")
    let raw = ""
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    if (url.pathname.startsWith("/api/")) {
      if (req.headers["x-api-key"] !== "token") return json(res, { message: "unauthorized" }, 401)
      return dokploy(req.method, url.pathname.slice(5), Object.fromEntries(url.searchParams), body, res)
    }
    if (url.pathname.startsWith("/gh/")) return github(req.method, url.pathname.slice(4) + url.search, body, res)
    if (url.pathname.startsWith("/s3")) {
      if (!/^AWS4-HMAC-SHA256 Credential=key\//.test(req.headers.authorization ?? "")) return empty(res, 403)
      return s3(req.method, url.pathname.slice(3) || "/", res)
    }
    return json(res, {}, 404)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return { s, origin, close: () => new Promise((resolve) => server.close(resolve)) }
}
