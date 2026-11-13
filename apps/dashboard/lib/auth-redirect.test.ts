import { expect, test } from "bun:test"
import { safeNext, withNext } from "./auth-redirect"

test("keeps a path with its query and drops the hash", () => {
  expect(safeNext("/queue?status=queued&q=acme#top")).toBe("/queue?status=queued&q=acme")
  expect(safeNext("/answers")).toBe("/answers")
})

test("falls back for every spelling of another origin", () => {
  const hostile = [
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "http://localhost:3002/queue",
    "javascript:alert(1)",
    "evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/%2f/evil.com",
    "/%2F%2Fevil.com",
    "/%5cevil.com",
    "/%5Cevil.com",
    "/%09/evil.com",
    "/%0a/evil.com",
    "/%00",
    "/%E0%A4%A",
    " //evil.com",
    "",
  ]
  for (const value of hostile) expect(safeNext(value)).toBe("/")
  expect(safeNext(`/${"a".repeat(3000)}`)).toBe("/")
  expect(safeNext(null)).toBe("/")
  expect(safeNext(undefined, "/queue")).toBe("/queue")
})

test("never sends the user back to an auth page or the api", () => {
  for (const value of [
    "/sign-in",
    "/sign-in?next=/queue",
    "/SIGN-UP",
    "/reset-password?token=x",
    "/api/auth/get-session",
    "/api",
  ]) {
    expect(safeNext(value)).toBe("/")
  }
  expect(safeNext("/sign-in-guide")).toBe("/sign-in-guide")
})

test("withNext carries only a real destination to the other auth page", () => {
  expect(withNext("/sign-up", "/queue?status=queued")).toBe("/sign-up?next=%2Fqueue%3Fstatus%3Dqueued")
  expect(withNext("/sign-up", "/")).toBe("/sign-up")
  expect(withNext("/sign-up", null)).toBe("/sign-up")
})
