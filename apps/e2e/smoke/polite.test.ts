import { describe, expect, test } from "bun:test"
import { createHostLimiter, createStrikes, isRefusal, isTrackerHost, SMOKE_USER_AGENT, sleep } from "./polite.ts"

describe("politeness", () => {
  test("the user agent names the tool and carries no personal detail", () => {
    expect(SMOKE_USER_AGENT).toMatch(
      /^skiffr-smoke\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/FindMalek\/skiffr; read-only smoke\)$/,
    )
  })

  test("one request per host at a time, other hosts in parallel", async () => {
    const limit = createHostLimiter()
    const active = { a: 0, b: 0 }
    const peak = { a: 0, b: 0 }
    const task = (host: "a" | "b") => async () => {
      active[host]++
      peak[host] = Math.max(peak[host], active[host])
      await sleep(15)
      active[host]--
    }
    await Promise.all([limit("a", task("a")), limit("a", task("a")), limit("a", task("a")), limit("b", task("b"))])
    expect(peak).toEqual({ a: 1, b: 1 })

    const started: string[] = []
    await Promise.all(
      (["a", "b"] as const).map((host) =>
        limit(host, async () => {
          started.push(host)
          await sleep(20)
        }),
      ),
    )
    expect(started).toEqual(["a", "b"])
  })

  test("a failed task does not block the next one", async () => {
    const limit = createHostLimiter()
    const first = limit("a", () => Promise.reject(new Error("boom")))
    await expect(first).rejects.toThrow("boom")
    expect(await limit("a", async () => "next")).toBe("next")
  })

  test("a second 429 or 403 from a host stops the run, one does not", () => {
    const strikes = createStrikes()
    strikes.record("jobs.lever.co")
    expect(strikes.stopped()).toBeNull()
    strikes.record("boards.greenhouse.io")
    expect(strikes.stopped()).toBeNull()
    strikes.record("jobs.lever.co")
    expect(strikes.stopped()).toBe("jobs.lever.co")
  })

  test("429 always counts, 403 only for the page and its api calls", () => {
    expect(isRefusal(429, "image")).toBe(true)
    expect(isRefusal(403, "document")).toBe(true)
    expect(isRefusal(403, "fetch")).toBe(true)
    expect(isRefusal(403, "script")).toBe(false)
    expect(isRefusal(404, "document")).toBe(false)
  })

  test("known trackers are recognised, a job board is not", () => {
    expect(isTrackerHost("www.google-analytics.com")).toBe(true)
    expect(isTrackerHost("script.hotjar.com")).toBe(true)
    expect(isTrackerHost("notgoogle-analytics.com")).toBe(false)
    expect(isTrackerHost("job-boards.greenhouse.io")).toBe(false)
  })
})
