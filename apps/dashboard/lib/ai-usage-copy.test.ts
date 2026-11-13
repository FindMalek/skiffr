import { expect, test } from "bun:test"
import { meterText, resetsAt, usageRows } from "./ai-usage-copy"

const day = "2026-11-10"
const summary = (rows: ReturnType<typeof usageRows>) => rows.map(({ used, left, percent }) => [used, left, percent])

test("each measure says what is used, what is left and how full the meter is", () => {
  const rows = usageRows({ day, calls: 12, tokens: 41_200, limits: { calls: 300, tokens: 1_000_000 } })
  expect(summary(rows)).toEqual([
    ["12 of 300 calls", "288 left", 4],
    ["41.2K of 1M tokens", "958.8K left", 4],
  ])
  expect(rows.map(meterText)).toEqual(["12 of 300 calls, 288 left", "41.2K of 1M tokens, 958.8K left"])
})

test("a limit of 0 has no meter and no remaining, and a spent limit stays at 100", () => {
  expect(summary(usageRows({ day, calls: 1, tokens: 5, limits: { calls: 0, tokens: 0 } }))).toEqual([
    ["1 call", null, null],
    ["5 tokens", null, null],
  ])
  expect(summary(usageRows({ day, calls: 320, tokens: 0, limits: { calls: 300, tokens: 10 } }))).toEqual([
    ["320 of 300 calls", "None left", 100],
    ["0 of 10 tokens", "10 left", 0],
  ])
})

test("the limit resets at the next midnight UTC, and a bad day gives nothing", () => {
  expect(resetsAt({ day })?.toISOString()).toBe("2026-11-11T00:00:00.000Z")
  expect(resetsAt({ day: "nope" })).toBeNull()
})
