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

  test("a token in the url is swapped for an http only cookie, a header works too, a wrong one never does", async () => {
    const { handle } = app({ config: { ...config, token: "s3cret" } })
    expect((await get(handle, "playground.localhost", "/inspect")).status).toBe(401)
    expect((await get(handle, "playground.localhost", "/api/submissions")).status).toBe(401)
    expect((await get(handle, "playground.localhost", "/inspect?token=nope")).status).toBe(401)
    const swapped = await get(handle, "playground.localhost", "/inspect?run=a&token=s3cret")
    expect(swapped.status).toBe(303)
    expect(swapped.headers.get("location")).toBe("/inspect?run=a")
    const cookie = swapped.headers.get("set-cookie") ?? ""
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Strict")
    const again = await get(handle, "playground.localhost", "/inspect", {
      headers: { cookie: cookie.split(";")[0] as string },
    })
    expect(again.status).toBe(200)
    expect(
      (await get(handle, "playground.localhost", "/api/submissions", { headers: { "x-playground-token": "s3cret" } }))
        .status,
    ).toBe(200)
  })

  test("on a production or public host without a token the private routes stay shut, the public ones keep working", async () => {
    const { handle } = app({ config: { ...config, locked: true, token: null } })
    for (const [method, path] of [
      ["GET", "/inspect"],
      ["GET", "/api/submissions"],
      ["DELETE", "/api/submissions"],
      ["GET", "/admin"],
      ["POST", "/admin/variant"],
      ["POST", "/admin/reset"],
    ] as const) {
      const response = await get(handle, "playground.localhost", path, { method })
      expect(`${method} ${path} ${response.status}`).toBe(`${method} ${path} 403`)
    }
    expect((await get(handle, "playground.localhost", "/")).status).toBe(200)
    expect((await get(handle, "playground.localhost", "/api/jobs")).status).toBe(200)
    expect((await get(handle, "lever.playground.localhost", "/")).status).toBe(200)
    expect((await post(handle, "site=lever", { a: "b" })).status).toBe(200)
  })

  test("the readable run id of a visit is the key to its own submissions and to nothing else", async () => {
    const { handle } = app({ config: { ...config, locked: true, token: null } })
    const mine = "a1b2c3d4e5f6a7b8c9d0"
    await post(handle, `site=lever&run=${mine}`, { __pg_fields: controls([control("Email", "a@b.test")]) })
    await post(handle, "site=lever&run=someone-elses-run-1234", {
      __pg_fields: controls([control("Email", "other@b.test")]),
    })
    const own = await get(handle, "playground.localhost", `/api/submissions?run=${mine}`)
    expect(((await own.json()) as { submissions: unknown[] }).submissions).toHaveLength(1)
    expect((await get(handle, "playground.localhost", "/api/submissions?run=short")).status).toBe(403)
    expect((await get(handle, "playground.localhost", "/inspect")).status).toBe(403)
    expect((await get(handle, "playground.localhost", `/inspect?run=${mine}`)).status).toBe(200)
    expect((await get(handle, "playground.localhost", "/api/submissions", { method: "DELETE" })).status).toBe(403)
  })

  test("an admin post from another site is refused even without a token, and with one it still needs the token", async () => {
    const open = app()
    const body = new URLSearchParams({ site: "lever", variant: "renamed-ids" })
    const attack = await open.handle(
      new Request("http://playground.localhost:3004/admin/variant", {
        method: "POST",
        body,
        headers: { origin: "http://evil.example", host: "playground.localhost:3004" },
      }),
    )
    const fetchSite = await open.handle(
      new Request("http://playground.localhost:3004/admin/variant", {
        method: "POST",
        body,
        headers: { "sec-fetch-site": "cross-site" },
      }),
    )
    const nullOrigin = await open.handle(
      new Request("http://playground.localhost:3004/admin/variant", {
        method: "POST",
        body,
        headers: { origin: "null" },
      }),
    )
    expect([attack.status, fetchSite.status, nullOrigin.status]).toEqual([403, 403, 403])
    // what a browser sends from the admin page itself: the policy hides the origin, the fetch metadata says same-origin
    const browser = await open.handle(
      new Request("http://playground.localhost:3004/admin/variant", {
        method: "POST",
        body: new URLSearchParams({ site: "lever", variant: "none" }),
        headers: { origin: "null", "sec-fetch-site": "same-origin" },
      }),
    )
    expect(browser.status).toBe(303)
    expect(open.variants.get("lever")).toBeNull()
    const locked = app({ config: { ...config, token: "s3cret" } })
    const same = { origin: "http://playground.localhost:3004", host: "playground.localhost:3004" }
    const noToken = await locked.handle(
      new Request("http://playground.localhost:3004/admin/variant", { method: "POST", body, headers: same }),
    )
    expect(noToken.status).toBe(401)
    const ok = await locked.handle(
      new Request("http://playground.localhost:3004/admin/variant", {
        method: "POST",
        body,
        headers: { ...same, "x-playground-token": "s3cret" },
      }),
    )
    expect(ok.status).toBe(303)
    expect(locked.variants.get("lever")).toBe("renamed-ids")
  })

  test("a noisy run cannot push out another run, and one address cannot write faster than the bucket allows", async () => {
    const { handle, store } = app({ config: { ...config, rateBurst: 0 } })
    await post(handle, "site=lever&run=ci", { __pg_fields: controls([control("Email", "a@b.test")]) })
    for (let index = 0; index < 30; index++) await post(handle, "site=lever&run=noise", { a: String(index) })
    expect(store.list({ run: "ci" })).toHaveLength(1)
    expect(store.list({ run: "noise" })).toHaveLength(store.perRun)

    const limited = app({ config: { ...config, rateBurst: 3, ratePerMinute: 1 } })
    const send = (ip: string) =>
      limited.handle(
        new Request("http://playground.localhost:3004/api/submissions?site=lever", {
          method: "POST",
          body: new URLSearchParams({ a: "b" }),
        }),
        { ip },
      )
    const codes = [await send("1.1.1.1"), await send("1.1.1.1"), await send("1.1.1.1"), await send("1.1.1.1")].map(
      (response) => response.status,
    )
    expect(codes).toEqual([200, 200, 200, 429])
    expect((await send("2.2.2.2")).status).toBe(200)
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

describe("a fake site says so", () => {
  test("every response is noindex and nosniff, robots.txt disallows everything, pages carry the banner and the meta", async () => {
    const { handle } = app()
    const robots = await get(handle, "playground.localhost", "/robots.txt")
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n")
    for (const [host, path] of [
      ["playground.localhost", "/"],
      ["lever.playground.localhost", "/"],
      ["playground.localhost", "/nope"],
    ] as const) {
      const response = await get(handle, host, path)
      expect(response.headers.get("x-robots-tag")).toContain("noindex")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    }
    const page = await (await get(handle, "lever.playground.localhost", "/")).text()
    expect(page).toContain('<meta name="robots" content="noindex, nofollow, noarchive">')
    expect(page).toContain("data-pg-banner")
    const index = await get(handle, "playground.localhost", "/")
    expect(index.headers.get("content-security-policy")).toContain("frame-ancestors 'self'")
  })

  test("the pages that borrow a brand layout keep a disclaimer even when bare, and the embed frame may be framed by its company page only", async () => {
    const { handle } = app()
    const linkedin = await (await get(handle, "linkedin.playground.localhost", "/?bare=1")).text()
    expect(linkedin).toContain("This is not LinkedIn")
    expect(linkedin).toContain("Easy Apply (test)")
    expect(await (await get(handle, "lever.playground.localhost", "/?bare=1")).text()).not.toContain("data-pg-banner")
    const frame = await get(handle, "embed-frame.playground.localhost", "/embed/job_app")
    expect(frame.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self' http://www.acme.test:3004 http://embed.playground.localhost:3004",
    )
    expect((await get(handle, "lever.playground.localhost", "/")).headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self'",
    )
    expect((await get(handle, "lever.playground.localhost", "/")).headers.get("content-security-policy")).not.toContain(
      "acme.test",
    )
  })

  test("a visit without a run gets an unguessable one, a bidi override is stripped, a field labelled password is never kept", async () => {
    const { handle, store } = app()
    const html = await (await get(handle, "generic.playground.localhost", "/")).text()
    expect(/"run":"[0-9a-f]{32}"/.test(html)).toBe(true)
    await post(handle, "site=generic&run=x", {
      __pg_fields: controls([
        control("Name \u202eevil", "a\u202eb"),
        control("Account Password", "hunter2", { name: "pw1" }),
      ]),
    })
    const [saved] = store.list({ run: "x" })
    expect(saved?.fields[0]).toMatchObject({ label: "Name evil", value: "ab" })
    expect(saved?.fields[1]?.value).toBe("[hidden]")
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
