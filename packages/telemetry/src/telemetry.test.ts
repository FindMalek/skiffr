import { afterAll, describe, expect, test } from "bun:test"
import {
  captureException,
  captureMessage,
  createThrottle,
  fromEnv,
  pushMetrics,
  sendRecords,
  sendUmamiEvent,
} from "./index.ts"

interface Seen {
  path: string
  headers: Headers
  body: string
}

const seen: Seen[] = []
let status = 200
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname.startsWith("/hop")) {
      return new Response(null, { status: 302, headers: { location: new URL("/elsewhere", request.url).href } })
    }
    seen.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.text() })
    return new Response("{}", { status })
  },
})
afterAll(() => server.stop(true))
const base = `http://127.0.0.1:${server.port}`

describe("disabled", () => {
  test("every exporter is a no-op without its env", async () => {
    const options = {
      env: {},
      fetch: (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch,
    }
    const disabled = { sent: false, reason: "disabled" } as const
    expect(await sendRecords([{ a: 1 }], options)).toEqual(disabled)
    expect(await pushMetrics([{ name: "x", value: 1 }], options)).toEqual(disabled)
    expect(await sendUmamiEvent({ name: "x" }, options)).toEqual(disabled)
    expect(await captureMessage("error", "x", {}, options)).toEqual(disabled)
    expect(await captureMessage("error", "x", {}, { env: { GLITCHTIP_DSN: "nonsense" } })).toEqual(disabled)
  })
})

describe("openobserve", () => {
  test("json ingest and otlp metrics go to the org paths with the auth header", async () => {
    seen.length = 0
    const env = { OPENOBSERVE_URL: `${base}/`, OPENOBSERVE_AUTH: "Basic c2VjcmV0", OPENOBSERVE_ORG: "acme" }
    const records = await sendRecords([{ target: "lever-acme", status: "drift" }], { env })
    const metrics = await pushMetrics([{ name: "skiffr.drift.targets", value: 2, attributes: { status: "drift" } }], {
      env,
    })
    expect(records).toEqual({ sent: true, status: 200 })
    expect(metrics).toEqual({ sent: true, status: 200 })
    expect(seen.map((one) => one.path)).toEqual(["/api/acme/skiffr_drift/_json", "/api/acme/v1/metrics"])
    expect(seen[0]?.headers.get("authorization")).toBe("Basic c2VjcmV0")
    const [row] = JSON.parse(seen[0]?.body ?? "[]")
    expect(row).toMatchObject({ target: "lever-acme", status: "drift" })
    expect(typeof row._timestamp).toBe("number")
    const point = JSON.parse(seen[1]?.body ?? "{}").resourceMetrics[0].scopeMetrics[0].metrics[0]
    expect(point).toMatchObject({ name: "skiffr.drift.targets", gauge: { dataPoints: [{ asDouble: 2 }] } })
  })

  test("a failing server never throws and the result holds no secret", async () => {
    status = 500
    const env = { OPENOBSERVE_URL: base, OPENOBSERVE_AUTH: "Basic c2VjcmV0" }
    const result = await sendRecords([{ a: 1 }], { env })
    const dead = await sendRecords([{ a: 1 }], { env: { ...env, OPENOBSERVE_URL: "http://127.0.0.1:1" } })
    status = 200
    expect(result).toEqual({ sent: false, error: "http 500" })
    expect(dead.sent).toBe(false)
    expect(JSON.stringify([result, dead])).not.toContain("c2VjcmV0")
  })
})

describe("umami", () => {
  test("posts an event with a user agent", async () => {
    seen.length = 0
    const env = { UMAMI_URL: base, UMAMI_WEBSITE_ID: "site-1", UMAMI_HOSTNAME: "playground.example" }
    await sendUmamiEvent({ name: "drift-detected", url: "/drift", data: { targets: 2 } }, { env })
    expect(seen[0]?.path).toBe("/api/send")
    expect(seen[0]?.headers.get("user-agent")).toBe("skiffr-telemetry/0.1")
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({
      type: "event",
      payload: {
        website: "site-1",
        hostname: "playground.example",
        url: "/drift",
        name: "drift-detected",
        data: { targets: 2 },
      },
    })
  })
})

describe("glitchtip", () => {
  test("sends a sentry envelope with the key in the auth header only", async () => {
    seen.length = 0
    const env = { GLITCHTIP_DSN: `http://abc123key@127.0.0.1:${server.port}/7` }
    const message = await captureMessage("error", "critical drift", { target: "x" }, { env })
    const exception = await captureException(new TypeError("boom"), {}, { env })
    expect(message.sent && exception.sent).toBe(true)
    expect(seen.map((one) => one.path)).toEqual(["/api/7/envelope/", "/api/7/envelope/"])
    expect(seen[0]?.headers.get("x-sentry-auth")).toBe(
      "Sentry sentry_version=7, sentry_key=abc123key, sentry_client=skiffr-telemetry/0.1",
    )
    const lines = (seen[0]?.body ?? "").split("\n")
    expect(JSON.parse(lines[1] ?? "{}")).toEqual({ type: "event" })
    expect(JSON.parse(lines[2] ?? "{}")).toMatchObject({
      level: "error",
      message: "critical drift",
      extra: { target: "x" },
    })
    expect(seen[1]?.body).toContain('"type":"TypeError"')
    expect(JSON.stringify([message, exception])).not.toContain("abc123key")
  })
})

test("fromEnv binds the env once", async () => {
  seen.length = 0
  const bound = fromEnv({ UMAMI_URL: base, UMAMI_WEBSITE_ID: "s" })
  expect(await bound.sendUmamiEvent({ name: "x" })).toEqual({ sent: true, status: 200 })
  expect(await bound.sendRecords([{ a: 1 }])).toEqual({ sent: false, reason: "disabled" })
})

describe("safety", () => {
  test("a redirect is not followed, so credentials never reach another hop", async () => {
    seen.length = 0
    const result = await sendRecords([{ a: 1 }], {
      env: { OPENOBSERVE_URL: `${base}/hop`, OPENOBSERVE_AUTH: "Basic c2VjcmV0" },
    })
    expect(result.sent).toBe(false)
    expect(seen).toEqual([])
  })

  test("a payload that cannot be serialized resolves, it never rejects", async () => {
    const env = { GLITCHTIP_DSN: `http://k@127.0.0.1:${server.port}/7` }
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect((await captureMessage("error", "x", { loop, big: 10n }, { env })).sent).toBe(true)
    expect(
      (
        await sendRecords([{ big: 10n as unknown as number }], {
          env: { OPENOBSERVE_URL: base, OPENOBSERVE_AUTH: "a" },
        })
      ).sent,
    ).toBe(false)
  })

  test("an exception ships its class only: no message, no stack, no object extras", async () => {
    seen.length = 0
    const env = { GLITCHTIP_DSN: `http://k@127.0.0.1:${server.port}/7` }
    await captureException(
      new TypeError("ana.silva@example.com is wrong"),
      { pathname: "/x", payload: { name: "Ana" } },
      { env },
    )
    const body = seen[0]?.body ?? ""
    expect(body).toContain('"type":"TypeError"')
    expect(body).not.toContain("ana.silva")
    expect(body).not.toContain("telemetry.test")
    expect(body).not.toContain("Ana")
    expect(body).toContain('"pathname":"/x"')
  })

  test("umami events past the budget are dropped, not queued", async () => {
    seen.length = 0
    const env = { UMAMI_URL: base, UMAMI_WEBSITE_ID: "s" }
    const throttle = createThrottle(2, 60_000)
    const results = await Promise.all([1, 2, 3, 4].map(() => sendUmamiEvent({ name: "x" }, { env, throttle })))
    expect(results.filter((one) => one.sent)).toHaveLength(2)
    expect(results.filter((one) => !one.sent && "error" in one && one.error === "throttled")).toHaveLength(2)
    expect(seen).toHaveLength(2)
  })
})
