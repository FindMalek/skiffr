import { expect, test } from "bun:test"
import { loadApiEnv } from "@skiffr/env/api"

const BASE = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "s".repeat(32) }
const load = (extra: Record<string, string>) => loadApiEnv({ ...BASE, ...extra })

test("the ai limits and the proxy settings have defaults, and an empty value falls back to them", () => {
  expect(load({ AI_DAILY_CALLS: "" })).toMatchObject({
    AI_DAILY_CALLS: 600,
    AI_DAILY_TOKENS: 1_000_000,
    AI_GLOBAL_DAILY_CALLS: 0,
    CLIENT_IP_HEADER: "x-forwarded-for",
    TRUSTED_PROXY_COUNT: 1,
  })
})

test("0 is no limit, and a limit is digits within what the database column holds", () => {
  expect(load({ AI_DAILY_CALLS: "0", AI_DAILY_TOKENS: "2147483647" })).toMatchObject({
    AI_DAILY_CALLS: 0,
    AI_DAILY_TOKENS: 2_147_483_647,
  })
  for (const bad of [" ", "-1", "1.5", "abc", "1e3", "2147483648", "99999999999", "NaN"]) {
    expect(() => load({ AI_DAILY_CALLS: bad })).toThrow("AI_DAILY_CALLS")
    expect(() => load({ AI_GLOBAL_DAILY_CALLS: bad })).toThrow("AI_GLOBAL_DAILY_CALLS")
  }
})

test("the number of trusted proxies is a small whole number", () => {
  expect(load({ TRUSTED_PROXY_COUNT: "0" }).TRUSTED_PROXY_COUNT).toBe(0)
  for (const bad of [" ", "11", "-1", "two"])
    expect(() => load({ TRUSTED_PROXY_COUNT: bad })).toThrow("TRUSTED_PROXY_COUNT")
})
