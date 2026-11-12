import { describe, expect, test } from "bun:test"
import { createRequestGuard, isPrivateAddress, localRefusal, urlRefusal } from "./guard.ts"

const hostOf = (url: string): string => new URL(url).hostname

describe("localRefusal through the url parser", () => {
  const refused = [
    "http://127.0.0.1/",
    "http://127.1/",
    "http://0x7f.1/",
    "http://0177.0.0.1/",
    "http://2130706433/",
    "http://0/",
    "http://127.0.0.1./",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::7f00:1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[64:ff9b::a00:1]/",
    "http://[2002:7f00:1::]/",
    "http://[2002:a9fe:a9fe::1]/",
    "http://[fec0::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "http://[100::1]/",
    "http://[2001:db8::1]/",
    "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/",
    "http://10.1.2.3/",
    "http://172.16.0.9/",
    "http://192.168.1.5/",
    "http://169.254.169.254/",
    "http://100.64.0.1/",
    "http://198.18.0.1/",
    "http://192.0.2.1/",
    "http://198.51.100.7/",
    "http://203.0.113.9/",
    "http://192.88.99.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    "http://localhost/",
    "http://localhost./",
    "http://app.localhost/",
    "http://intranet/",
    "http://printer.local/",
    "http://jobs.skiffr.test/",
    "http://corp.internal/",
  ]
  test.each(refused)("refuses %s", (url) => {
    expect(localRefusal(hostOf(url))).not.toBeNull()
  })

  const allowed = [
    "http://boards.greenhouse.io/",
    "http://jobs.lever.co/",
    "http://8.8.8.8/",
    "http://172.32.0.1/",
    "http://[2606:4700::1111]/",
    "http://[2a00:1450:4001::200e]/",
  ]
  test.each(allowed)("allows %s", (url) => {
    expect(localRefusal(hostOf(url))).toBeNull()
  })

  test("a raw spelling is normalized the same way", () => {
    expect(localRefusal("::ffff:7f00:1")).not.toBeNull()
    expect(localRefusal("[::ffff:127.0.0.1]")).not.toBeNull()
    expect(localRefusal("0x7f.1")).not.toBeNull()
  })
})

test("isPrivateAddress reads every v6 form of an internal v4 address", () => {
  for (const ip of ["::ffff:7f00:1", "::ffff:127.0.0.1", "::7f00:1", "64:ff9b::7f00:1", "fe80::1%eth0"]) {
    expect(isPrivateAddress(ip)).toBe(true)
  }
  expect(isPrivateAddress("93.184.216.34")).toBe(false)
  expect(isPrivateAddress("not an address")).toBe(false)
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

describe("createRequestGuard", () => {
  test("refuses every spelling of loopback for a page load, a sub request and a websocket", async () => {
    const guard = createRequestGuard({ allowLocal: false, topHost: "jobs.lever.co" })
    for (const url of [
      "http://127.0.0.1:1/",
      "https://[::ffff:127.0.0.1]:1/x",
      "http://[::ffff:7f00:1]:1/",
      "ws://[::ffff:7f00:1]:1/ws",
      "wss://127.1/",
      "http://0x7f000001/",
      "http://[::ffff:a9fe:a9fe]/latest/meta-data",
    ]) {
      expect(await guard(url)).not.toBeNull()
    }
  })

  test("a local test page may load its own host and nothing else private", async () => {
    const guard = createRequestGuard({ allowLocal: true, topHost: "127.0.0.1" })
    expect(await guard("http://127.0.0.1:5000/a.css")).toBeNull()
    expect(await guard("ws://localhost:5001/")).not.toBeNull()
    expect(await guard("http://[::ffff:7f00:2]/")).not.toBeNull()
  })

  test("non network urls are not judged and odd schemes are refused", async () => {
    const guard = createRequestGuard({ allowLocal: false, topHost: "jobs.lever.co" })
    expect(await guard("data:text/plain,hi")).toBeNull()
    expect(await guard("file:///etc/passwd")).not.toBeNull()
    expect(await guard("chrome://version")).not.toBeNull()
  })
})
