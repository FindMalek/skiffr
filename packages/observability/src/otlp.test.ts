import { afterAll, expect, test } from "bun:test"
import { createObservability, noopObservability } from "./observability"
import { parseHeaders } from "./otlp"
import { mockCollector } from "./testing"

const collector = mockCollector()
afterAll(() => collector.stop())

const make = (extra = {}) =>
  createObservability({
    service: "skiffr-api",
    environment: "test",
    otlpEndpoint: `${collector.url}/api/default`,
    otlpHeaders: "authorization=Basic%20abc,stream-name=skiffr",
    flushMs: 0,
    ...extra,
  })

test("headers come in the standard otel format", () => {
  expect(parseHeaders("a=1, B=x%20y,bad")).toEqual({ a: "1", b: "x y" })
})

test("logs and metrics reach the collector with the headers, and only allowlisted attributes", async () => {
  collector.requests.length = 0
  const o = make()
  o.logEvent("info", "http.request", { "http.method": "GET", "http.status_code": 200, cookie: "session=1" })
  o.count("skiffr.http.requests", 1, { "http.status_class": "2xx" })
  o.count("skiffr.http.requests", 1, { "http.status_class": "2xx" })
  o.gauge("skiffr.db.up", 1)
  o.observe("skiffr.http.duration_ms", 40, { "http.method": "GET" })
  await o.flush()
  const paths = collector.requests.map((request) => request.path).sort()
  expect(paths).toEqual(["/api/default/v1/logs", "/api/default/v1/metrics"])
  expect(collector.requests[0]?.headers.get("authorization")).toBe("Basic abc")
  expect(collector.requests[0]?.headers.get("stream-name")).toBe("skiffr")
  const logs = JSON.parse(collector.requests.find((r) => r.path.endsWith("/logs"))?.body ?? "{}")
  const record = logs.resourceLogs[0].scopeLogs[0].logRecords[0]
  expect(record.body.stringValue).toBe("http.request")
  expect(record.attributes.map((a: { key: string }) => a.key).sort()).toEqual([
    "deploy_env",
    "http.method",
    "http.status_code",
  ])
  const metrics = JSON.parse(collector.requests.find((r) => r.path.endsWith("/metrics"))?.body ?? "{}")
  const named = Object.fromEntries(
    metrics.resourceMetrics[0].scopeMetrics[0].metrics.map((m: { name: string }) => [m.name, m]),
  )
  expect(named["skiffr.http.requests"].sum.dataPoints[0].asDouble).toBe(2)
  expect(named["skiffr.db.up"].gauge.dataPoints[0].asDouble).toBe(1)
  expect(named["skiffr.http.duration_ms"].histogram.dataPoints[0].count).toBe("1")
})

test("with nothing set no request leaves and nothing throws", async () => {
  collector.requests.length = 0
  const o = createObservability({ service: "s", environment: "t" })
  o.captureError(new Error("x"))
  o.logEvent("info", "x")
  o.count("skiffr.x")
  o.track("ai_budget_exhausted")
  expect(await o.traceAi({ operation: "chat", model: "m" }, async () => 5)).toBe(5)
  await o.flush()
  await noopObservability.flush()
  expect(collector.requests).toHaveLength(0)
})

test("a model call is a span with model, tokens and outcome, and no prompt or answer unless content capture is on", async () => {
  const run = async (captureContent: boolean) => {
    collector.requests.length = 0
    const o = make({ captureContent })
    await o.traceAi({ operation: "chat", model: "openai/gpt-oss-120b" }, async (span) =>
      span.record({
        inputTokens: 11,
        outputTokens: 7,
        finishReason: "stop",
        prompt: "PROMPT-TEXT",
        completion: "ANSWER-TEXT",
      }),
    )
    await o.flush()
    return collector.requests.map((request) => request.body).join("\n")
  }
  const off = await run(false)
  expect(off).toContain("openai/gpt-oss-120b")
  expect(off).toContain("gen_ai.usage.input_tokens")
  expect(off).not.toContain("PROMPT-TEXT")
  expect(off).not.toContain("ANSWER-TEXT")
  const on = await run(true)
  expect(on).toContain("PROMPT-TEXT")
  expect(on).toContain("ANSWER-TEXT")
})

test("a refused or failed model call is a span with its outcome and error class, never the message", async () => {
  collector.requests.length = 0
  const o = make()
  class ModelBudgetError extends Error {
    override name = "ModelBudgetError"
  }
  await expect(
    o.traceAi({ operation: "embed", model: "m" }, async () => {
      throw new ModelBudgetError("x")
    }),
  ).rejects.toThrow()
  await expect(
    o.traceAi({ operation: "chat", model: "m" }, async () => {
      throw new Error("jane@example.com")
    }),
  ).rejects.toThrow()
  await o.flush()
  const body = collector.everything()
  expect(body).toContain('"stringValue":"budget"')
  expect(body).toContain('"stringValue":"error"')
  expect(body).not.toContain("jane@example.com")
})

test("an unreachable collector costs nothing but the batch", async () => {
  const o = createObservability({
    service: "s",
    environment: "t",
    otlpEndpoint: "http://localhost:1/api/default",
    flushMs: 0,
  })
  o.logEvent("info", "x")
  await o.flush()
})

test("a flood of labels on one metric can't push out the others", async () => {
  collector.requests.length = 0
  const o = make()
  o.gauge("skiffr.db.up", 1)
  for (let i = 0; i < 1500; i++) o.count("skiffr.http.requests", 1, { "http.route": `/v1/answers/jane${i}` })
  o.gauge("skiffr.scheduler.runs", 1, { job: "gmail" })
  await o.flush()
  const metrics = JSON.parse(collector.requests.find((r) => r.path.endsWith("/metrics"))?.body ?? "{}")
    .resourceMetrics[0].scopeMetrics[0].metrics as Array<{ name: string; sum?: { dataPoints: unknown[] } }>
  const names = metrics.map((metric) => metric.name)
  expect(names).toContain("skiffr.db.up")
  expect(names).toContain("skiffr.scheduler.runs")
  const flooded = metrics.find((metric) => metric.name === "skiffr.http.requests")
  expect(flooded?.sum?.dataPoints.length).toBeLessThanOrEqual(301)
  const points = (flooded?.sum?.dataPoints ?? []) as Array<{ asDouble: number }>
  const total = points.reduce((sum, point) => sum + point.asDouble, 0)
  expect(total).toBe(1500)
})

test("a redirect from a sink is not followed, so a header or a key never goes to another host", async () => {
  const target = mockCollector()
  const redirector = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 307, headers: { location: `${target.url}/elsewhere` } }),
  })
  try {
    const o = createObservability({
      service: "s",
      environment: "t",
      glitchtipDsn: `http://key@localhost:${redirector.port}/1`,
      otlpEndpoint: `http://localhost:${redirector.port}/api/default`,
      otlpHeaders: "x-secret=1",
      umamiUrl: `http://localhost:${redirector.port}`,
      umamiWebsiteId: "11111111-2222-4333-8444-555555555555",
      flushMs: 0,
    })
    o.captureError(new Error("x"))
    o.logEvent("info", "http.request")
    o.track("ai_budget_exhausted")
    await o.flush()
    expect(target.requests).toEqual([])
  } finally {
    redirector.stop(true)
    target.stop()
  }
})

test("a hostile error never changes what traceAi throws", async () => {
  const hostile = new Error("x")
  Object.defineProperty(hostile, "name", {
    get() {
      throw new Error("getter")
    },
  })
  await expect(
    make().traceAi({ operation: "chat", model: "m" }, async () => {
      throw hostile
    }),
  ).rejects.toBe(hostile)
})

const UMAMI_ID = "11111111-2222-4333-8444-555555555555"

test("product events are capped per minute", () => {
  let at = 1_000
  let sent = 0
  const o = createObservability({
    service: "s",
    environment: "t",
    umamiUrl: "http://umami.test",
    umamiWebsiteId: UMAMI_ID,
    now: () => at,
    fetch: async () => {
      sent++
      return new Response("{}")
    },
  })
  for (let i = 0; i < 200; i++) o.track("ai_budget_exhausted", { limit: "daily" })
  expect(sent).toBe(60)
  at += 61_000
  o.track("ai_budget_exhausted")
  expect(sent).toBe(61)
})

test("flush waits for a product event in flight", async () => {
  let done = false
  const o = createObservability({
    service: "s",
    environment: "t",
    umamiUrl: "http://umami.test",
    umamiWebsiteId: UMAMI_ID,
    fetch: async () => {
      await Bun.sleep(50)
      done = true
      return new Response("{}")
    },
  })
  o.track("ai_budget_exhausted")
  await o.flush()
  expect(done).toBe(true)
})
