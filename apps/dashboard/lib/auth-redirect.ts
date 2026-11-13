const ORIGIN = "https://dashboard.invalid"
const NEXT_MAX = 2048
const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"]

/** Control characters and backslashes: URL parsers drop or turn them into slashes, so `/\t/evil.com` becomes `//evil.com`. */
const odd = (value: string) => [...value].some((char) => char.charCodeAt(0) <= 0x1f || char === "\x7f" || char === "\\")

const hostile = (value: string) => odd(value) || value.startsWith("//")

/** A single leading slash followed by a real path character (or the bare root): the only shape that stays on this origin. */
const onOrigin = (path: string) => path === "/" || /^\/[^/\\]/.test(path)

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Where to go after signing in: a path on this dashboard or `fallback`. Anything else (another origin, a scheme, `//host`,
 * a backslash or control character, which browsers read as a slash, the auth pages themselves, the api) is dropped.
 * The checks run on the raw value, on its decoded spelling and on what the URL parser returns: the parser collapses dot
 * segments, so `/.//evil.com` comes back as `//evil.com`, which a browser reads as another host.
 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (typeof value !== "string" || value.length > NEXT_MAX || !value.startsWith("/") || hostile(value)) return fallback
  const decoded = decode(value)
  if (decoded === null || hostile(decoded)) return fallback
  const url = new URL(value, ORIGIN)
  if (url.origin !== ORIGIN) return fallback
  const result = url.pathname + url.search
  const path = decode(url.pathname)
  if (path === null || hostile(result) || hostile(path) || !onOrigin(result) || !onOrigin(path)) return fallback
  const guarded = [url.pathname, path].map((candidate) => candidate.toLowerCase())
  const blocked = (candidate: string) =>
    candidate === "/api" ||
    candidate.startsWith("/api/") ||
    AUTH_PAGES.some((page) => candidate === page || candidate.startsWith(`${page}/`))
  return guarded.some(blocked) ? fallback : result
}

/** The same `next` for a link to the other auth page, or nothing when there is none worth keeping. */
export function withNext(path: string, next: string | null): string {
  return next && next !== "/" ? `${path}?next=${encodeURIComponent(next)}` : path
}
