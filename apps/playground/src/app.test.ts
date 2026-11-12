import { describe, expect, test } from "bun:test"
import { createApp } from "./app.ts"
import { readConfig } from "./config.ts"
import { routeFor } from "./hosts.ts"

const config = readConfig({ PORT: "3004", PLAYGROUND_URL: "http://playground.localhost:3004" })
const silent = {
  sendUmamiEvent: async () => ({ sent: false as const, reason: "disabled" as const }),
  captureException: async () => ({ sent: false as const, reason: "disabled" as const }),
}

function app(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({ config, telemetry: silent, ...overrides })
}

const get = (handle: ReturnType<typeof app>["handle"], host: string, path = "/", init: RequestInit = {}) =>
  handle(
    new Request(`http://${host}:3004${path}`, {
      ...init,
      headers: { host: `${host}:3004`, ...(init.headers as object) },
    }),
  )

function post(
  handle: ReturnType<typeof app>["handle"],
  query: string,
  entries: Record<string, string>,
  accept = "text/html",
) {
  const body = new URLSearchParams(entries)
  return handle(
    new Request(`http://playground.localhost:3004/api/submissions?${query}`, {
      method: "POST",
      body,
      headers: { accept },
    }),
  )
}

const controls = (list: object[]) => JSON.stringify(list)
const control = (label: string, value: string, extra: object = {}) => ({
  id: "",
  name: label,
  label,
  type: "text",
  required: false,
  disabled: false,
  visible: true,
  trap: false,
  value,
  ...extra,
})

describe("submissions", () => {
  test("a post is recorded with what was filled and left empty, and only the playground answers it", async () => {
    const { handle, store } = app()
    const response = await post(handle, "site=lever&run=r1", {
      name: "Ana Silva",
      password: "hunter2",
      __pg_fields: controls([
        control("Full name", "Ana Silva", { required: true }),
        control("Phone", "", { required: true }),
        control("Website", ""),
      ]),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("Application submitted!")
    const [saved] = store.list({ run: "r1" })
    expect(saved?.counts).toMatchObject({ filled: 1, empty: 2, requiredEmpty: 1 })
    expect(saved?.posted.find((item) => item.name === "password")?.value).toBe("[hidden]")
    expect(JSON.stringify(saved)).not.toContain("hunter2")
  })

  test("a sensitive field or a trap that holds a value turns the inspect page red, a clean run does not", async () => {
    const { handle } = app()
    await post(handle, "site=eeo&run=red", {
      __pg_fields: controls([
        control("Gender", "Female", { type: "select" }),
        control("Website", "https://x.test", { trap: true, visible: false }),
      ]),
    })
    await post(handle, "site=eeo&run=clean", {
      __pg_fields: controls([control("Gender", ""), control("Email", "ana@example.com")]),
    })
    const red = await (await get(handle, "playground.localhost", "/inspect?run=red")).text()
    const clean = await (await get(handle, "playground.localhost", "/inspect?run=clean")).text()
    expect(red).toContain('data-guard="failed"')
    expect(red).toContain("sensitive field was filled")
    expect(red).toContain("hidden trap was filled")
    expect(clean).toContain('data-guard="held"')
  })

  test("anything a page reports is escaped and cut down before /inspect prints it", async () => {
    const { handle } = app()
    await post(handle, "site=generic&run=x", {
      __pg_fields: controls([
        control("<img src=x onerror=alert(1)>", `<script>alert(1)</script>\u0000${"a".repeat(900)}`),
      ]),
    })
    const html = await (await get(handle, "playground.localhost", "/inspect?run=x")).text()
    expect(html).not.toContain("<script>alert")
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("a".repeat(400))
  })

  test("a body over the limit is refused before it is read", async () => {
    const { handle } = app()
    const response = await handle(
      new Request("http://playground.localhost:3004/api/submissions", {
        method: "POST",
        body: "a=b",
        headers: { "content-length": "9000000" },
      }),
    )
    expect(response.status).toBe(413)
  })

  test("the inspect page and the api need the token when one is set", async () => {
    const { handle } = app({ config: { ...config, token: "s3cret" } })
    expect((await get(handle, "playground.localhost", "/inspect")).status).toBe(401)
    expect((await get(handle, "playground.localhost", "/api/submissions")).status).toBe(401)
    expect((await get(handle, "playground.localhost", "/inspect?token=s3cret")).status).toBe(200)
    expect(
      (await get(handle, "playground.localhost", "/api/submissions", { headers: { "x-playground-token": "s3cret" } }))
        .status,
    ).toBe(200)
  })
})

describe("pages", () => {
  test("a board page keeps its markup, posts to the playground and refuses to post anywhere else", async () => {
    const { handle } = app()
    const response = await get(handle, "lever.playground.localhost", "/")
    const html = await response.text()
    expect(html).toContain('action="/api/submissions"')
    expect(html).not.toContain("/submit?")
    expect(html).toContain('id="job-description"')
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'")
  })

  test("the break it page flips one page into a variant, ?variant=none restores it for one request", async () => {
    const { handle, variants } = app()
    const flip = await handle(
      new Request("http://playground.localhost:3004/admin/variant", {
        method: "POST",
        body: new URLSearchParams({ site: "lever", variant: "new-required-field" }),
      }),
    )
    expect(flip.status).toBe(303)
    expect(variants.get("lever")).toBe("new-required-field")
    const changed = await (await get(handle, "lever.playground.localhost")).text()
    const original = await (await get(handle, "lever.playground.localhost", "/?variant=none")).text()
    const other = await (await get(handle, "ashby.playground.localhost")).text()
    expect(changed).toContain('"variant":"new-required-field"')
    expect(original).toContain('"variant":""')
    expect(other).toContain('"variant":""')
  })

  test("the switches reach the page, latency is capped", async () => {
    const { handle } = app()
    const html = await (
      await get(handle, "greenhouse.playground.localhost", "/?latency=999999&cookie=1&layout=b&run=a-1")
    ).text()
    expect(html).toContain('"latency":10000')
    expect(html).toContain('"cookie":"1"')
    expect(html).toContain('"layout":"b"')
    expect(html).toContain('"run":"a-1"')
  })

  test("every listed page renders", async () => {
    const { handle } = app()
    const jobs = (await (await get(handle, "playground.localhost", "/api/jobs")).json()) as {
      jobs: { site: string; url: string }[]
    }
    expect(jobs.jobs.length).toBeGreaterThanOrEqual(20)
    for (const job of jobs.jobs) {
      const url = new URL(job.url)
      const response = await handle(new Request(job.url, { headers: { host: url.host } }))
      expect(`${job.site} ${response.status}`).toBe(`${job.site} 200`)
    }
  })
})

describe("host mapping", () => {
  test("a real board host, a subdomain and a path all reach the same page, and a shared host is told apart by path", () => {
    expect(routeFor(config, "job-boards.greenhouse.io:443", "/acme/jobs/1").route).toMatchObject({
      site: { id: "greenhouse" },
    })
    expect(routeFor(config, "greenhouse.playground.localhost:3004", "/").route).toMatchObject({
      site: { id: "greenhouse" },
    })
    expect(routeFor(config, "playground.localhost:3004", "/s/lever/acme/x")).toMatchObject({
      route: { site: { id: "lever" }, viaPath: true },
      path: "/acme/x",
    })
    expect(routeFor(config, "boards.greenhouse.io", "/acme/jobs/1").route).toMatchObject({
      site: { id: "greenhouse-legacy" },
    })
    expect(routeFor(config, "boards.greenhouse.io", "/embed/job_app").route).toMatchObject({
      site: { id: "embed-frame" },
    })
    expect(routeFor(config, "example.org", "/").route).toEqual({ kind: "index" })
  })

  test("job urls follow the public url: subdomains by default, /s/<site> without a wildcard name", async () => {
    const wildcard = (await (await get(app().handle, "playground.localhost", "/api/jobs")).json()) as {
      jobs: { site: string; url: string }[]
    }
    expect(wildcard.jobs.find((job) => job.site === "lever")?.url).toBe(
      "http://lever.playground.localhost:3004/acme/6ddc5e28-5b1e-4a0e-9a3a-000000000001/apply",
    )
    const flat = app({ config: { ...config, subdomains: false } })
    const paths = (await (await get(flat.handle, "playground.localhost", "/api/jobs")).json()) as {
      jobs: { site: string; url: string }[]
    }
    expect(paths.jobs.find((job) => job.site === "lever")?.url).toStartWith(
      "http://playground.localhost:3004/s/lever/acme/",
    )
  })
})
