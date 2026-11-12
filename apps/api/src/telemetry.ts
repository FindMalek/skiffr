import { getObservability, statusClass } from "@skiffr/observability"

const PROCEDURE_PATH = /^\/(rpc|v1)(\/[a-z][A-Za-z0-9_.-]{0,40}){1,5}$/

/**
 * The route a request is filed under: a procedure path, or a fixed name. Anything else (a file key, a probe of
 * random urls) is `other`, so a log line or a metric label never carries a value someone typed into a url.
 */
export function routeOf(pathname: string, status: number): string {
  if (pathname === "/health") return "/health"
  if (pathname.startsWith("/files/")) return "/files/:key"
  if (pathname.startsWith("/auth/")) return "/auth/*"
  if (pathname.startsWith("/gmail/")) return "/gmail/*"
  if (status === 404) return "other"
  return PROCEDURE_PATH.test(pathname) ? pathname : "other"
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

/** One structured line and two metrics per request: method, route, status and time. No query, header, body, cookie, address or user. */
export function recordRequest(request: Request, response: Response, startedAt: number): void {
  const obs = getObservability()
  const duration = Math.round(performance.now() - startedAt)
  const method = METHODS.has(request.method) ? request.method : "GET"
  const route = routeOf(new URL(request.url).pathname, response.status)
  const attrs = {
    "http.method": method,
    "http.route": route,
    "http.status_code": response.status,
    "http.status_class": statusClass(response.status),
    duration_ms: duration,
    request_id: response.headers.get("x-request-id") ?? undefined,
  }
  obs.logEvent(response.status >= 500 ? "error" : "info", "http.request", attrs)
  const labels = { "http.method": method, "http.route": route, "http.status_class": attrs["http.status_class"] }
  obs.count("skiffr.http.requests", 1, labels)
  obs.observe("skiffr.http.duration_ms", duration, labels)
}
