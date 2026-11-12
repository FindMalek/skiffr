import { expect, test } from "bun:test"
import { isOlderVersion, parseClient } from "./client"

test("a client header is a name and a version, anything else is ignored", () => {
  expect(parseClient("extension-chrome/0.3.1")).toEqual({ client: "extension-chrome", clientVersion: "0.3.1" })
  expect(parseClient("extension-firefox/1.0.0-beta.2")?.clientVersion).toBe("1.0.0-beta.2")
  for (const bad of [
    null,
    "",
    "extension",
    "x/1",
    "Mozilla/5.0 (X11; Linux)",
    "a/1.0.0 extra",
    `a/${"1".repeat(9)}.0.0`,
  ])
    expect(parseClient(bad), String(bad)).toBeNull()
})

test("versions compare by number, a pre-release is older than its release", () => {
  expect(isOlderVersion("0.9.0", "0.10.0")).toBe(true)
  expect(isOlderVersion("0.10.0", "0.9.0")).toBe(false)
  expect(isOlderVersion("1.2.3", "1.2.3")).toBe(false)
  expect(isOlderVersion("1.2.0-beta.1", "1.2.0")).toBe(true)
  expect(isOlderVersion("1.2.0", "1.2.0-beta.1")).toBe(false)
  expect(isOlderVersion("garbage", "1.0.0")).toBe(false)
})
