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

test("dot segments that the url parser collapses into //host fall back", () => {
  const dots = [
    "/.//evil.com",
    "/..//evil.com",
    "/a/..//evil.com",
    "/a/b/../..//evil.com",
    "/%2e//evil.com",
    "/%2E//evil.com",
    "/%2e%2e//evil.com",
    "/.%2e//evil.com",
    "/..///evil.com",
    "/././/evil.com",
    "/.//@evil.com",
    "/..//evil.com/x?y=1",
  ]
  for (const value of dots) expect(safeNext(value)).toBe("/")
  expect(safeNext("/a/../queue")).toBe("/queue")
})

test("no spelling of a prefix, a slash pair and a host leaves this origin", () => {
  const prefixes = ["", ".", "..", "a/..", "%2e", "%2e%2e", ".%2e", "./.", "a/b/../.."]
  const slashes = ["/", "//", "/%2f", "%2f/", "%2f%2f", "/%2F", "/\\", "/%5c", "%5c/", "/\t", "/%09", "/%0a", "/%00"]
  const hosts = ["evil.com", "@evil.com", "evil.com/x?y=1", "evil.com:8080", "%65vil.com"]
  const encode = [
    (value: string) => value,
    (value: string) => encodeURIComponent(value).replaceAll("%2F", "/"),
    (value: string) => value.replaceAll(".", "%2e"),
  ]
  let checked = 0
  for (const prefix of prefixes) {
    for (const slash of slashes) {
      for (const host of hosts) {
        for (const spell of encode) {
          const result = safeNext(spell(`/${prefix}${slash}${host}`))
          const url = new URL(result, "https://app.test")
          expect(url.origin).toBe("https://app.test")
          expect(result === "/" || /^\/[^/\\]/.test(result)).toBe(true)
          checked += 1
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(500)
})

test("never sends the user back to an auth page or the api", () => {
  for (const value of [
    "/sign-in",
    "/sign-in?next=/queue",
    "/SIGN-UP",
    "/reset-password?token=x",
    "/api/auth/get-session",
    "/api",
    "/%61pi/x",
    "/%73ign-in",
    "/%73ign-up?next=/queue",
    "/a/../api/x",
    "/%2e%2e/sign-in",
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
