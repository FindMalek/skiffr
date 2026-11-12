import { expect, test } from "bun:test"
import { usageLine } from "./ai-usage-copy"

test("the line says what is spent against each limit, and drops the limit when there is none", () => {
  const day = "2026-11-10"
  expect(usageLine({ day, calls: 12, tokens: 41_200, limits: { calls: 300, tokens: 1_000_000 } })).toBe(
    "12 of 300 calls and 41.2K of 1M tokens used today. Resets at midnight UTC.",
  )
  expect(usageLine({ day, calls: 1, tokens: 5, limits: { calls: 0, tokens: 0 } })).toBe(
    "1 call and 5 tokens used today. No daily limit.",
  )
})
