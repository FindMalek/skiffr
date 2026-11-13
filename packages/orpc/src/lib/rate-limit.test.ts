import { expect, test } from "bun:test"
import { DEFAULT_RATE_RULES, RateLimiter, type RateRules } from "./rate-limit"

const RULES: RateRules = {
  read: { burst: 3, perMinute: 60 },
  write: { burst: 2, perMinute: 30 },
  embed: { burst: 1, perMinute: 6 },
  upload: { burst: 1, perMinute: 6 },
  ai: { burst: 1, perMinute: 6 },
  expensive: { burst: 1, perMinute: 6 },
  sensitive: { burst: 1, perMinute: 6 },
}

function setup(rules: RateRules = RULES) {
  let at = 1_000_000
  const limiter = new RateLimiter(rules, () => at)
  return {
    limiter,
    tick: (ms: number) => {
      at += ms
    },
  }
}

test("a burst passes, then calls wait for the bucket to refill, and the wait is the time to the next token", () => {
  const { limiter, tick } = setup()
  expect([1, 2, 3].map(() => limiter.take("ana", "read").ok)).toEqual([true, true, true])
  expect(limiter.take("ana", "read")).toEqual({ ok: false, retryAfterSeconds: 1 })

  tick(1_000)
  expect(limiter.take("ana", "read").ok).toBe(true)
  expect(limiter.take("ana", "read").ok).toBe(false)

  expect(limiter.take("ana", "ai").ok).toBe(true)
  expect(limiter.take("ana", "ai")).toEqual({ ok: false, retryAfterSeconds: 10 })
  tick(4_000)
  expect(limiter.take("ana", "ai")).toEqual({ ok: false, retryAfterSeconds: 6 })
  tick(6_000)
  expect(limiter.take("ana", "ai").ok).toBe(true)
})

test("a bucket never holds more than its burst, however long it was idle", () => {
  const { limiter, tick } = setup()
  limiter.take("ana", "write")
  tick(60 * 60_000)
  expect([1, 2, 3].map(() => limiter.take("ana", "write").ok)).toEqual([true, true, false])
})

test("users and classes count apart", () => {
  const { limiter } = setup()
  expect(limiter.take("ana", "ai").ok).toBe(true)
  expect(limiter.take("ana", "ai").ok).toBe(false)
  expect(limiter.take("ben", "ai").ok).toBe(true)
  expect(limiter.take("ana", "expensive").ok).toBe(true)
  expect(limiter.take("ana", "read").ok).toBe(true)
})

test("the defaults are tighter for model calls and network calls than for reads", () => {
  expect(DEFAULT_RATE_RULES.ai.perMinute).toBeLessThan(DEFAULT_RATE_RULES.write.perMinute)
  expect(DEFAULT_RATE_RULES.expensive.perMinute).toBeLessThan(DEFAULT_RATE_RULES.write.perMinute)
  expect(DEFAULT_RATE_RULES.write.perMinute).toBeLessThan(DEFAULT_RATE_RULES.read.perMinute)
})

test("a clock that steps back neither locks anyone out nor refunds, the bucket is re-based on the new time", () => {
  const { limiter, tick } = setup()
  expect([1, 2, 3].map(() => limiter.take("ana", "read").ok)).toEqual([true, true, true])
  tick(-60_000)
  expect(limiter.take("ana", "read")).toEqual({ ok: false, retryAfterSeconds: 1 })
  tick(1_000)
  expect(limiter.take("ana", "read").ok).toBe(true)
})
