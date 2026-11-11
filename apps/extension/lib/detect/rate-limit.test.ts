import { expect, test } from "bun:test"
import { createRateLimiter } from "./rate-limit"

test("allows three calls per window and recovers after it", () => {
  let now = 0
  const allow = createRateLimiter(3, 5000, () => now)
  expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false])
  now = 4999
  expect(allow()).toBe(false)
  now = 5001
  expect(allow()).toBe(true)
})
