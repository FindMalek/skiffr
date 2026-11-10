import { expect, test } from "bun:test"
import { withSecurityHeaders } from "./headers"

test("redirects and json responses get the security headers, hsts only over https", () => {
  const redirected = withSecurityHeaders(Response.redirect("http://localhost/v1/docs", 302), { https: false })
  expect(redirected.status).toBe(302)
  expect(redirected.headers.get("location")).toBe("http://localhost/v1/docs")
  expect(redirected.headers.get("x-content-type-options")).toBe("nosniff")
  expect(redirected.headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
  expect(redirected.headers.has("strict-transport-security")).toBe(false)

  const json = withSecurityHeaders(Response.json({ ok: true }), { https: true })
  expect(json.headers.get("content-type")).toContain("application/json")
  expect(json.headers.get("strict-transport-security")).toContain("max-age=")

  const own = withSecurityHeaders(new Response("x", { headers: { "content-security-policy": "default-src 'none'" } }), {
    https: false,
  })
  expect(own.headers.get("content-security-policy")).toBe("default-src 'none'")
})
