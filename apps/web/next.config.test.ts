import { expect, test } from "bun:test"
import config from "./next.config"

test("every route carries the baseline security headers", async () => {
  const rules = (await config.headers?.()) ?? []
  const rule = rules.find((r) => r.source === "/:path*")
  const headers = Object.fromEntries((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]))
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["strict-transport-security"]).toContain("max-age=")
  expect(headers["referrer-policy"]).toBeString()
  expect(headers["permissions-policy"]).toBeString()
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'")
})
