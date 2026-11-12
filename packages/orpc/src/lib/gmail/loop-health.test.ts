import { afterAll, expect, test } from "bun:test"
import { createObservability, noopObservability, setObservability } from "@skiffr/observability"
import { mockCollector } from "@skiffr/observability/testing"
import type { Leader } from "./leader"
import { createLoop } from "./scheduler"

const collector = mockCollector()
afterAll(() => collector.stop())
const leader: Leader = { tryAcquire: async () => true, release: async () => undefined }

test("a loop that fails reports its job and the error class, never what the error said, and counts the run", async () => {
  const observability = createObservability({
    service: "skiffr-api",
    environment: "test",
    glitchtipDsn: `http://k@${collector.url.replace("http://", "")}/3`,
    otlpEndpoint: `${collector.url}/api/default`,
    flushMs: 0,
  })
  setObservability(observability)
  try {
    const ok = createLoop(async () => 4, { job: "watch", leader, intervalMs: 60_000 })
    expect(await ok.tick()).toBe(4)
    const failing = createLoop(
      async () => {
        throw new Error("could not read mail for jane@example.com")
      },
      {
        job: "gmail",
        leader,
        intervalMs: 60_000,
        onError: (error) => observability.captureError(error, { job: "gmail" }),
      },
    )
    expect(await failing.tick()).toBe(0)
    await observability.flush()
    const sent = collector.everything()
    expect(sent).toContain("skiffr.scheduler.runs")
    expect(sent).toContain("skiffr.scheduler.last_success_seconds")
    expect(sent).toContain('"stringValue":"error"')
    expect(sent).toContain('"type":"Error"')
    expect(sent).not.toContain("jane@example.com")
  } finally {
    setObservability(noopObservability)
  }
})
