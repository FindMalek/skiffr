import { afterAll, expect, test } from "bun:test"
import { createErrorReporter, parseDsn } from "./glitchtip"
import { mockCollector } from "./testing"

const collector = mockCollector()
afterAll(() => collector.stop())
const dsn = `http://abc123@${collector.url.replace("http://", "")}/42`

test("a dsn names the envelope endpoint and a key, and a broken one is off", () => {
  expect(parseDsn("https://k@errors.example.com/9")).toEqual({
    key: "k",
    envelopeUrl: "https://errors.example.com/api/9/envelope/",
  })
  for (const bad of ["", "nope", "https://errors.example.com/9", "https://k@errors.example.com/x", "ftp://k@h/1"])
    expect(parseDsn(bad)).toBeNull()
  expect(createErrorReporter({ dsn: "nope", environment: "t", service: "s" })).toBeNull()
})

test("an error is posted as an envelope with the key, its class, a stack and allowlisted tags", async () => {
  const reporter = createErrorReporter({ dsn, environment: "production", service: "skiffr-api" })
  reporter?.capture(new TypeError("secret message with jane@example.com"), {
    job: "gmail",
    account_id: "acc-1",
    note: "free text",
  })
  await reporter?.flush()
  const [request] = collector.requests
  expect(request?.path).toBe("/api/42/envelope/")
  expect(request?.headers.get("x-sentry-auth")).toContain("sentry_key=abc123")
  const [, itemHeader, payload] = (request?.body ?? "").split("\n")
  expect(JSON.parse(itemHeader ?? "{}")).toEqual({ type: "event" })
  const event = JSON.parse(payload ?? "{}")
  expect(event.environment).toBe("production")
  expect(event.exception.values[0].type).toBe("TypeError")
  expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0)
  expect(event.tags).toEqual({ job: "gmail", account_id: "acc-1" })
  expect(request?.body).not.toContain("jane@example.com")
})

test("a server that is down or slow never throws into the caller, and a burst is capped", async () => {
  const down = createErrorReporter({ dsn: "http://k@localhost:1/1", environment: "t", service: "s", perMinute: 2 })
  for (let i = 0; i < 5; i++) down?.capture(new Error("x"))
  await down?.flush()

  const before = collector.requests.length
  const capped = createErrorReporter({ dsn, environment: "t", service: "s", perMinute: 3, now: () => 1_000 })
  for (let i = 0; i < 10; i++) capped?.capture(new Error("x"))
  await capped?.flush()
  expect(collector.requests.length - before).toBe(3)
})
