import { afterAll, expect, test } from "bun:test"
import { mockCollector } from "./testing"

const collector = mockCollector()
afterAll(() => collector.stop())
const ENTRY = new URL("./index.ts", import.meta.url).pathname

test("an uncaught exception reaches the collector before the process exits with code 1", async () => {
  const script = `
    import { createObservability, reportCrashes } from ${JSON.stringify(ENTRY)}
    reportCrashes(createObservability({ service: "skiffr-api", environment: "test", glitchtipDsn: process.env.DSN, flushMs: 0 }), { job: "api" })
    setTimeout(() => { throw new TypeError("boom for jane@example.com") }, 10)
    setTimeout(() => {}, 10000)
  `
  const child = Bun.spawn([process.execPath, "-e", script], {
    env: { ...process.env, DSN: `http://k@${collector.url.replace("http://", "")}/5` },
    stdout: "ignore",
    stderr: "ignore",
  })
  expect(await child.exited).toBe(1)
  const [request] = collector.requests
  expect(request?.path).toBe("/api/5/envelope/")
  expect(request?.body).toContain('"type":"TypeError"')
  expect(request?.body).not.toContain("jane@example.com")
})
