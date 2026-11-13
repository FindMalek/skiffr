import { describe, expect, test } from "bun:test"
import type { TargetResult } from "./drift.ts"
import { exitCodeOf, needsAttention, renderSummary, tally } from "./summary.ts"

const result = (over: Partial<TargetResult>): TargetResult => ({
  id: "a",
  ats: "lever",
  status: "ok",
  reasons: [],
  notes: [],
  observation: {
    toast: true,
    collected: 14,
    filled: 11,
    outlined: 4,
    left: 3,
    sensitiveAsked: 0,
    sensitiveFilled: 0,
    consoleErrors: 1,
  } as NonNullable<TargetResult["observation"]>,
  writesAborted: 0,
  ms: 12_400,
  ...over,
})

describe("summary", () => {
  const results = [
    result({}),
    result({ id: "b", status: "drift", reasons: ["filled fell from 6 to 3"] }),
    result({ id: "c", status: "gone", reasons: ["http 404"], observation: null }),
    result({ id: "d", status: "blocked", reasons: ["http 429"], observation: null }),
  ]

  test("counts every status", () => {
    expect(tally(results)).toMatchObject({ ok: 1, drift: 1, gone: 1, blocked: 1, error: 0 })
  })

  test("renders one row per target with its numbers", () => {
    const text = renderSummary(results, "2026-11-12")
    expect(text.split("\n")[0]).toBe("smoke run 2026-11-12: ok 1, drift 1, gone 1, blocked 1")
    expect(text).toContain("| a | lever | ok | 14 | 11 | 4 | 3 | 0/0 | 1 | 12 |  |")
    expect(text).toContain("| b | lever | drift | 14 | 11 | 4 | 3 | 0/0 | 1 | 12 | filled fell from 6 to 3 |")
    expect(text).toContain("| c | lever | gone |  |  |  |  |  |  | 12 | http 404 |")
  })

  test("a pipe in a detail cannot break the table", () => {
    const text = renderSummary([result({ notes: ["a | b"] })], "2026-11-12")
    expect(text).toContain("a / b")
  })

  test("only drift and error need attention, a gone or blocked page does not", () => {
    expect(needsAttention(results)).toBe(true)
    expect(needsAttention([results[0] as TargetResult, results[2] as TargetResult, results[3] as TargetResult])).toBe(
      false,
    )
    expect(needsAttention([result({ status: "error" })])).toBe(true)
  })

  test("markdown and mentions in a detail are escaped", () => {
    const text = renderSummary([result({ notes: ["<img src=x> `code` @someone"] })], "2026-11-12")
    expect(text).toContain("\\<img src=x\\> \\`code\\` \\@someone")
  })

  test("a run that verified nothing never exits clean", () => {
    const only = (status: TargetResult["status"]) => [result({ status }), result({ id: "b", status })]
    expect(exitCodeOf([result({}), result({ id: "b", status: "gone" })])).toBe(0)
    expect(exitCodeOf(only("ok"))).toBe(0)
    expect(exitCodeOf([result({}), result({ id: "b", status: "drift" })])).toBe(1)
    expect(exitCodeOf(only("error"))).toBe(1)
    for (const status of ["gone", "blocked", "skipped"] as const) expect(exitCodeOf(only(status))).toBe(3)
    expect(exitCodeOf([])).toBe(3)
  })
})
