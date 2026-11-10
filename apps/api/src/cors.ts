export type Handler = (request: Request) => Promise<Response>

const ANY_EXTENSION = /^chrome-extension:\/\/[a-p]{32}$/
const BEARER_ROUTES = /^\/(rpc|v1)(\/|$)/

/**
 * The extension calls `/rpc` and `/v1` from a `chrome-extension://` origin with a bearer token. Those routes get CORS for
 * that origin only (`origins` pins ids, empty allows any extension); nothing else does, and credentials are never allowed:
 * the cookie is dropped from extension requests so a call is its token or nothing.
 */
export function withExtensionCors(handler: Handler, origins: string[] = []): Handler {
  const allowed = (origin: string) => (origins.length ? origins.includes(origin) : ANY_EXTENSION.test(origin))

  return async (request) => {
    const origin = request.headers.get("origin")
    if (!origin || !BEARER_ROUTES.test(new URL(request.url).pathname) || !allowed(origin)) return handler(request)

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "600",
          vary: "Origin",
        },
      })
    }

    const headers = new Headers(request.headers)
    headers.delete("cookie")
    const response = await handler(new Request(request, { headers }))
    const out = new Headers(response.headers)
    out.set("access-control-allow-origin", origin)
    out.append("vary", "Origin")
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out })
  }
}
