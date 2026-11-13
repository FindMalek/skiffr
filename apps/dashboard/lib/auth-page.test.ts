import { expect, test } from "bun:test"
import { authPageProps } from "./auth-page"

const ON = { github: true, passwordReset: false }

test("a hostile next in the url never reaches the form", () => {
  for (const next of [
    "//evil.com",
    "/.//evil.com",
    "/%2e%2e//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/%73ign-in",
  ]) {
    expect(authPageProps({ next }, ON).next).toBe("/")
  }
  expect(authPageProps({ next: ["/.//evil.com", "/queue"] }, ON).next).toBe("/")
  expect(authPageProps({ next: "/queue?status=queued" }, ON).next).toBe("/queue?status=queued")
  expect(authPageProps({}, ON).next).toBeNull()
})

test("the GitHub error banner shows for a known code and only when GitHub is on", () => {
  expect(authPageProps({ error: "access_denied" }, ON).notice).toBe("GitHub sign in was cancelled.")
  expect(authPageProps({ error: "state_mismatch" }, ON).notice).toContain("couldn't sign you in")
  expect(authPageProps({ error: "<img src=x>" }, ON).notice).toBeNull()
  expect(authPageProps({ error: "x" }, ON).notice).toBeNull()
  expect(authPageProps({ error: "access_denied" }, { github: false, passwordReset: false }).notice).toBeNull()
})
