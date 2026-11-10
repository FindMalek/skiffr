/**
 * Headers every api response carries unless a handler already set its own. There is no CORS on purpose:
 * browsers reach the api through the apps' same-origin proxies, and server-side or REST clients do not
 * need it. Add an allow list here if you open `/v1` to other origins.
 */
export function withSecurityHeaders(response: Response, opts: { https: boolean }): Response {
  // Redirects and fetched responses can have immutable headers, so copy them.
  const headers = new Headers(response.headers)
  const defaults: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "frame-ancestors 'none'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  }
  if (opts.https) defaults["strict-transport-security"] = "max-age=63072000; includeSubDomains"
  for (const [name, value] of Object.entries(defaults)) if (!headers.has(name)) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
