import { afterAll, expect, test } from "bun:test"
import { createObservability, noopObservability, setObservability } from "@skiffr/observability"
import { mockCollector } from "@skiffr/observability/testing"
import { recordRequest } from "./telemetry"

const collector = mockCollector()
afterAll(() => {
  setObservability(noopObservability)
  collector.stop()
})

interface Line {
  body: string
  severity: string
  attrs: Record<string, unknown>
}

async function lines(requests: Array<[string, number, string?]>): Promise<{ lines: Line[]; metrics: string }> {
  collector.requests.length = 0
  const observability = createObservability({
    service: "skiffr-api",
    environment: "test",
    otlpEndpoint: `${collector.url}/api/default`,
    flushMs: 0,
  })
  setObservability(observability)
  for (const [url, status, method] of requests)
    recordRequest(
      new Request(`http://api.test${url}`, { method }),
      new Response(null, { status }),
      performance.now() - 14,
    )
  await observability.flush()
  const logs = collector.requests.find((request) => request.path.endsWith("/logs"))?.body
  const records = logs ? JSON.parse(logs).resourceLogs[0].scopeLogs[0].logRecords : []
  return {
    metrics: collector.requests.find((request) => request.path.endsWith("/metrics"))?.body ?? "",
    lines: records.map(
      (record: {
        body: { stringValue: string }
        severityText: string
        attributes: Array<{ key: string; value: Record<string, string> }>
      }) => ({
        body: record.body.stringValue,
        severity: record.severityText,
        attrs: Object.fromEntries(record.attributes.map((a) => [a.key, Object.values(a.value)[0]])),
      }),
    ),
  }
}

test("the log line reads METHOD route status duration and the attributes keep their names", async () => {
  const { lines: sent } = await lines([["/v1/answers/abc?x=1", 200]])
  expect(sent[0]?.body).toMatch(/^GET \/v1\/answers\/:id 200 1[45]ms$/)
  expect(Object.keys(sent[0]?.attrs ?? {}).sort()).toEqual([
    "deploy_env",
    "duration_ms",
    "event",
    "http.method",
    "http.route",
    "http.status_class",
    "http.status_code",
  ])
  expect(sent[0]?.attrs.event).toBe("http.request")
})

test("5xx is ERROR, 4xx is WARN, the rest is INFO", async () => {
  const { lines: sent } = await lines([
    ["/v1/answers/abc", 503],
    ["/v1/answers/abc", 404],
    ["/v1/answers/abc", 302],
    ["/v1/answers/abc", 200],
  ])
  expect(sent.map((line) => line.severity)).toEqual(["ERROR", "WARN", "INFO", "INFO"])
})

test("passing health checks are counted in the metrics but not shipped as log lines", async () => {
  const { lines: sent, metrics } = await lines([
    ["/health", 200],
    ["/health?probe=1", 204],
    ["/version", 200],
  ])
  expect(sent.map((line) => line.body.split(" ")[1])).toEqual(["other"])
  expect(metrics).toContain("/health")
})

test("a typed segment, a query or a hostile url never reaches the line, only the route template", async () => {
  const { lines: sent } = await lines([
    ["/v1/answers/jane.doe@example.com", 404, "PATCH"],
    ["/v1/answers/3f2c9a10-1b2c-4d3e-8f90-123456789abc/use?token=SECRET", 200, "POST"],
    ["/rpc/answers/jane", 404],
    ["/files/resume-of-Jane-Doe.pdf?sig=SECRET", 302],
    ["/auth/callback/google?code=SECRET", 200],
    ["/v1/answers/%0d%0aSet-Cookie:x%20%22y%22", 400],
  ])
  expect(sent.map((line) => line.body.replace(/ 1[45]ms$/, ""))).toEqual([
    "PATCH /v1/answers/:id 404",
    "POST /v1/answers/:id/use 200",
    "GET other 404",
    "GET /files/:key 302",
    "GET /auth/* 200",
    "GET /v1/answers/:id 400",
  ])
  for (const line of sent)
    for (const leak of ["jane", "Jane", "SECRET", "3f2c9a10", "@", "?", "%", "Cookie"])
      expect(line.body).not.toContain(leak)
})

test("a custom method is logged as GET, never as the method string", async () => {
  const token = `X${"a1B2c3D4e5".repeat(6)}`
  const { lines: sent } = await lines([
    ["/v1/answers/abc", 200, "PROPFIND"],
    ["/v1/answers/abc", 200, token],
  ])
  expect(sent.map((line) => line.body.split(" ")[0])).toEqual(["GET", "GET"])
  expect(JSON.stringify(sent)).not.toContain(token)
  expect(sent.every((line) => line.attrs["http.method"] === "GET")).toBe(true)
})

test("a failing health check is logged, a passing one is not", async () => {
  const ok = await lines([["/health", 200]])
  expect(ok.lines).toEqual([])
  const down = await lines([["/health", 503]])
  expect(down.lines[0]?.body).toMatch(/^GET \/health 503 \d+ms$/)
  expect(down.lines[0]?.severity).toBe("ERROR")
})

test("the duration is never negative or not a number", async () => {
  collector.requests.length = 0
  setObservability(
    createObservability({
      service: "skiffr-api",
      environment: "test",
      otlpEndpoint: `${collector.url}/api/default`,
      flushMs: 0,
    }),
  )
  recordRequest(
    new Request("http://api.test/v1/answers/abc"),
    new Response(null, { status: 200 }),
    performance.now() + 5000,
  )
  recordRequest(new Request("http://api.test/v1/answers/abc"), new Response(null, { status: 200 }), Number.NaN)
  await (await import("@skiffr/observability")).getObservability().flush()
  const body = collector.requests.find((request) => request.path.endsWith("/logs"))?.body ?? ""
  expect(body).not.toMatch(/-\d+ms|NaNms|Infinityms/)
})
