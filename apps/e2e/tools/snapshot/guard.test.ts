import { describe, expect, test } from "bun:test"
import { isPrivateAddress, localRefusal, urlRefusal } from "./guard.ts"

describe("localRefusal", () => {
  const refused = [
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.9",
    "192.168.1.5",
    "169.254.169.254",
    "100.64.0.1",
    "[::1]",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "intranet",
    "printer.local",
    "jobs.skiffr.test",
    "corp.internal",
  ]
  test.each(refused)("refuses %s", (host) => {
    expect(localRefusal(host)).not.toBeNull()
  })

  test.each(["boards.greenhouse.io", "jobs.lever.co", "8.8.8.8", "172.32.0.1", "2606:4700::1111"])(
    "allows %s",
    (host) => {
      expect(localRefusal(host)).toBeNull()
    },
  )

  test("numeric hosts are normalised by the url parser before the check", () => {
    expect(localRefusal(new URL("http://2130706433/").hostname)).not.toBeNull()
  })
})

describe("urlRefusal", () => {
  test.each(["file:///etc/passwd", "javascript:alert(1)", "ftp://a.com", "https://user:pw@jobs.lever.co/a", "nope"])(
    "refuses %s",
    (url) => {
      expect(urlRefusal(url)).not.toBeNull()
    },
  )

  test("allows a plain https page", () => {
    expect(urlRefusal("https://jobs.lever.co/acme/1/apply")).toBeNull()
  })
})

test("isPrivateAddress tells public from private", () => {
  expect(isPrivateAddress("93.184.216.34")).toBe(false)
  expect(isPrivateAddress("192.168.0.1")).toBe(true)
})
