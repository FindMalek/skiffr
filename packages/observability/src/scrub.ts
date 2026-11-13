export type Attrs = Record<string, string | number | boolean>

/** `string` keeps only identifier-like values (no spaces, quotes or `@`), a list keeps only its members. */
export type AttrRule = "string" | "number" | "boolean" | readonly string[]
export type Allowlist = Readonly<Record<string, AttrRule>>

/** A form label, an email, a sentence or a token never matches: no whitespace, `@`, `=` or `+`, and at most 80 characters. */
const SAFE_STRING = /^[A-Za-z0-9_.:/-]{1,80}$/
const NAME = /^[a-z][a-z0-9_.]{0,63}$/

/** A readable log line: words, digits and the route characters only. No quote, `@`, `=`, `?`, `%` or `#`, so a query string or an email can't ride along. */
const SAFE_LINE = /^[A-Za-z0-9 _.:/*-]{1,160}$/

export const isSafeLine = (line: unknown): line is string => typeof line === "string" && SAFE_LINE.test(line)

export const isSafeName = (name: unknown): name is string => typeof name === "string" && NAME.test(name)

function keep(value: unknown, rule: AttrRule): string | number | boolean | undefined {
  if (Array.isArray(rule)) return typeof value === "string" && rule.includes(value) ? value : undefined
  if (rule === "string") return typeof value === "string" && SAFE_STRING.test(value) ? value : undefined
  if (rule === "number") return typeof value === "number" && Number.isFinite(value) ? value : undefined
  return typeof value === "boolean" ? value : undefined
}

/** Allowlist, never a denylist: a key that is not listed is dropped, and so is a value that does not fit its rule. */
export function allowlisted(input: Record<string, unknown> | undefined, allow: Allowlist): Attrs {
  const out: Attrs = {}
  if (!input) return out
  for (const [key, rule] of Object.entries(allow)) {
    if (!Object.hasOwn(input, key)) continue
    const value = keep(input[key], rule)
    if (value !== undefined) out[key] = value
  }
  return out
}

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const
export const JOBS = ["gmail", "watch", "prune", "api", "web", "dashboard", "docs"] as const
export const OUTCOMES = ["ok", "error", "skipped", "budget", "refused"] as const

/**
 * Every key that may leave the process, on a log line, a metric, a span or an error report. Ids and codes only: a field
 * label, a field value, resume or job text, an email and a token have no key here, so they can't be sent by accident.
 * Adding a key is a privacy decision and goes through review.
 */
export const ATTRIBUTES = {
  event: "string",
  "http.method": METHODS,
  "http.route": "string",
  "http.status_code": "number",
  "http.status_class": ["2xx", "3xx", "4xx", "5xx"],
  duration_ms: "number",
  request_id: "string",
  deploy_env: "string",
  route: "string",
  job: JOBS,
  outcome: OUTCOMES,
  items: "number",
  account_id: "string",
  source_id: "string",
  error_class: "string",
  error_code: "string",
  error_kind: "string",
  error_status: "number",
  limit_class: ["read", "write", "embed", "ai", "expensive", "upload"],
  operation: ["chat", "embed"],
  model: "string",
  provider: "string",
  direction: ["input", "output"],
  scope: ["user", "server"],
  db_ok: "boolean",
} as const satisfies Allowlist

export const scrubAttrs = (input: Record<string, unknown> | undefined): Attrs => allowlisted(input, ATTRIBUTES)
