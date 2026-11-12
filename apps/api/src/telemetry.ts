import { isProcedure } from "@orpc/server"
import { getObservability, statusClass } from "@skiffr/observability"
import { appRouter } from "@skiffr/orpc"

const segments = (path: string) => path.split("/").filter(Boolean)

/** Every procedure of the router: its rpc path (`answers/update`) and its rest template (`/answers/{id}`). */
function procedures(node: unknown, path: string[] = []): Array<{ rpc: string; rest: string | undefined }> {
  if (isProcedure(node)) return [{ rpc: path.join("/"), rest: node["~orpc"].route.path }]
  if (!node || typeof node !== "object") return []
  return Object.entries(node).flatMap(([key, child]) => procedures(child, [...path, key]))
}

const ALL = procedures(appRouter)
const RPC_PATHS = new Set(ALL.map((item) => `/rpc/${item.rpc}`))
const REST_TEMPLATES = ALL.flatMap((item) => (item.rest ? [item.rest] : []))
  .map((template) => ({ template: `/v1${template}`.replace(/\{(\w+)\}/g, ":$1"), parts: segments(`/v1${template}`) }))
  // a literal route (`/jobs/next`) wins over a param one (`/jobs/{id}`)
  .sort(
    (a, b) =>
      b.parts.filter((part) => !part.startsWith("{")).length - a.parts.filter((part) => !part.startsWith("{")).length,
  )

function restTemplateOf(pathname: string): string | undefined {
  const parts = segments(pathname)
  return REST_TEMPLATES.find(
    (item) =>
      item.parts.length === parts.length &&
      item.parts.every((part, index) => part.startsWith("{") || part === parts[index]),
  )?.template
}

/**
 * The route a request is filed under, taken from the router and never from what was typed: an rpc path or a rest
 * template (`/v1/answers/{id}`) that exists, a fixed name, or `other`. A probe of random urls, or a record id in a path,
 * can't add a label.
 */
export function routeOf(pathname: string): string {
  if (pathname === "/health") return "/health"
  if (pathname.startsWith("/files/")) return "/files/:key"
  if (pathname.startsWith("/auth/")) return "/auth/*"
  if (pathname.startsWith("/gmail/")) return "/gmail/*"
  if (RPC_PATHS.has(pathname)) return pathname
  if (pathname === "/v1/docs" || pathname === "/v1/openapi.json") return pathname
  return restTemplateOf(pathname) ?? "other"
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

/** One structured line and two metrics per request: method, route, status and time. No query, header, body, cookie, address or user. */
export function recordRequest(request: Request, response: Response, startedAt: number): void {
  const obs = getObservability()
  const duration = Math.round(performance.now() - startedAt)
  const method = METHODS.has(request.method) ? request.method : "GET"
  const route = routeOf(new URL(request.url).pathname)
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
