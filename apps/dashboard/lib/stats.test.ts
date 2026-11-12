import { expect, test } from "bun:test"
import { hoursText, niceMax, parseDays, rate } from "./stats"

test("only the listed ranges are used, anything else is 30 days", () => {
  expect([parseDays("7"), parseDays(["90", "7"]), parseDays("8"), parseDays(undefined), parseDays("1e1")]).toEqual([
    7, 90, 30, 30, 30,
  ])
})

test("a rate needs enough applications, and the axis tops out on a round number", () => {
  expect(rate(2, 4)).toBeNull()
  expect(rate(2, 5)).toBe(0.4)
  expect([niceMax(0), niceMax(3), niceMax(11), niceMax(70), niceMax(500)]).toEqual([1, 5, 20, 100, 500])
  expect([hoursText(0.4), hoursText(12), hoursText(30.5), hoursText(72)]).toEqual([
    "under 1 h",
    "12 h",
    "30.5 h",
    "3.0 d",
  ])
})
