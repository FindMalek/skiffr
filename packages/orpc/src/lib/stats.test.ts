import { expect, test } from "bun:test"
import { fillDays, groupWeeks, matchBucket, rangeStart, weekOf } from "./stats"

test("weeks start on Monday UTC, so a Sunday belongs to the week before", () => {
  expect(weekOf("2026-11-09")).toBe("2026-11-09")
  expect(weekOf("2026-11-15")).toBe("2026-11-09")
  expect(weekOf("2026-11-08")).toBe("2026-11-02")
})

test("a range of 7 days ends today, zero days are kept and weeks add up", () => {
  const now = new Date("2026-11-12T23:59:59.999Z")
  const from = rangeStart(now, 7)
  expect(from.toISOString()).toBe("2026-11-06T00:00:00.000Z")
  const days = fillDays(
    from,
    now,
    new Map([
      ["2026-11-08", 2],
      ["2026-11-10", 3],
    ]),
  )
  expect(days.map((d) => d.day)).toEqual([
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
  ])
  expect(groupWeeks(days)).toEqual([
    { week: "2026-11-02", count: 2 },
    { week: "2026-11-09", count: 3 },
  ])
})

test("match scores fall in the first bucket they do not pass, no score is its own", () => {
  expect(matchBucket(49)).toBe("0-49")
  expect(matchBucket(50)).toBe("50-69")
  expect(matchBucket(100)).toBe("85-100")
  expect(matchBucket(null)).toBe("none")
})
