const ORIGIN = "https://dashboard.invalid"
const NEXT_MAX = 2048
const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"]

/** Control characters and backslashes: URL parsers drop or turn them into slashes, so `/\t/evil.com` becomes `//evil.com`. */
const odd = (value: string) => [...value].some((char) => char.charCodeAt(0) <= 0x1f || char === "\x7f" || char === "\\")

const hostile = (value: string) => odd(value) || value.startsWith("//")

/**
 * Where to go after signing in: a path on this dashboard or `fallback`. Anything else (another origin, a scheme, `//host`,
 * a backslash or control character, which browsers read as a slash, the auth pages themselves, the api) is dropped, in
 * the raw and in the once-decoded spelling.
 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (typeof value !== "string" || value.length > NEXT_MAX || !value.startsWith("/") || hostile(value)) return fallback
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return fallback
  }
  if (hostile(decoded)) return fallback
  const url = new URL(value, ORIGIN)
  if (url.origin !== ORIGIN) return fallback
  const path = url.pathname.toLowerCase()
  if (path === "/api" || path.startsWith("/api/")) return fallback
  if (AUTH_PAGES.some((page) => path === page || path.startsWith(`${page}/`))) return fallback
  return url.pathname + url.search
}

/** The same `next` for a link to the other auth page, or nothing when there is none worth keeping. */
export function withNext(path: string, next: string | null): string {
  return next && next !== "/" ? `${path}?next=${encodeURIComponent(next)}` : path
}
