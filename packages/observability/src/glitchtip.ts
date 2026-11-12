import { safeErrorFields } from "./errors"
import { type Attrs, scrubAttrs } from "./scrub"

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export interface ErrorReporterOptions {
  dsn: string
  environment: string
  service: string
  fetch?: Fetch
  now?: () => number
  /** Reports per minute; the rest are dropped, so a failing loop can't flood the server. */
  perMinute?: number
}

export interface ParsedDsn {
  key: string
  envelopeUrl: string
}

/** `https://<key>@host/<project id>`: anything else is off, never an exception at boot. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn)
    const projectId = url.pathname.replace(/^\/+|\/+$/g, "")
    if (!/^https?:$/.test(url.protocol) || !url.username || !/^\d+$/.test(projectId)) return null
    return {
      key: decodeURIComponent(url.username),
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    }
  } catch {
    return null
  }
}

const FRAME = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/

/** Sentry wants the oldest frame first. Only function, file and position: no source lines, no variables. */
function frames(lines: string[] | undefined) {
  return (lines ?? [])
    .map((line) => FRAME.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, fn, filename, line, column]) => ({
      function: fn?.slice(0, 120),
      filename: filename?.slice(0, 200),
      lineno: Number(line),
      colno: Number(column),
    }))
    .reverse()
}

/** Sentry tag values are strings: `error_status` or `items` arrive as numbers and `db_ok` as a boolean. */
const stringTags = (tags: Attrs): Record<string, string> =>
  Object.fromEntries(Object.entries(tags).map(([key, value]) => [key, String(value)]))

/**
 * The event is built from `safeErrorFields` and allowlisted tags, field by field, so it never holds the error's own
 * message, its cause, a request, headers, a body or breadcrumbs. An SDK would capture those by default and scrub them
 * afterwards; this sends only what is named here.
 */
export function buildEvent(error: unknown, tags: Attrs, options: { environment: string; service: string }, at: number) {
  const fields = safeErrorFields(error)
  const stack = frames(fields.frames)
  const type = fields.name
  const detail = [fields.message, fields.code && `code ${fields.code}`, fields.status && `status ${fields.status}`]
    .filter(Boolean)
    .join(", ")
  return {
    event_id: crypto.randomUUID().replaceAll("-", ""),
    timestamp: at / 1000,
    platform: "javascript",
    level: "error",
    environment: options.environment,
    server_name: options.service,
    logger: options.service,
    exception: {
      values: [{ type, value: detail || type, ...(stack.length > 0 ? { stacktrace: { frames: stack } } : {}) }],
    },
    tags: stringTags({
      ...tags,
      ...(fields.causeName && fields.causeName !== type ? { cause: fields.causeName } : {}),
      ...(fields.constraint ? { constraint: fields.constraint } : {}),
      ...(fields.table ? { table: fields.table } : {}),
    }),
    fingerprint: [type, fields.code ?? "", String(tags.route ?? tags.job ?? "")],
  }
}

export interface ErrorReporter {
  capture(error: unknown, context?: Record<string, unknown>): void
  flush(): Promise<void>
}

export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter | null {
  const dsn = parseDsn(options.dsn)
  if (!dsn) return null
  const send: Fetch = options.fetch ?? ((url, init) => fetch(url, init))
  const now = options.now ?? Date.now
  const limit = options.perMinute ?? 30
  const pending = new Set<Promise<unknown>>()
  let windowStart = 0
  let used = 0

  return {
    capture(error, context) {
      try {
        const at = now()
        if (at - windowStart >= 60_000) {
          windowStart = at
          used = 0
        }
        if (++used > limit) return
        const event = buildEvent(error, scrubAttrs(context), options, at)
        const body = [
          JSON.stringify({ event_id: event.event_id, sent_at: new Date(at).toISOString() }),
          JSON.stringify({ type: "event" }),
          JSON.stringify(event),
        ].join("\n")
        const request = send(dsn.envelopeUrl, {
          method: "POST",
          headers: {
            "content-type": "application/x-sentry-envelope",
            "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=skiffr/1`,
          },
          body,
          signal: AbortSignal.timeout(3000),
          redirect: "error",
        })
          .catch(() => undefined)
          .finally(() => pending.delete(request))
        pending.add(request)
      } catch {
        // reporting must never break the caller
      }
    },
    async flush() {
      await Promise.allSettled([...pending])
    },
  }
}
