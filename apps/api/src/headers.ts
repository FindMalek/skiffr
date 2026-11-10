/**
 * Headers every api response carries unless a handler already set its own. Web apps reach the api through their
 * same-origin proxies, so the only CORS is the extension's (see `cors.ts`).
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
