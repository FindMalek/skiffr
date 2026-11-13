import type { WATCH_SOURCE_ERRORS } from "@skiffr/common/constants"
import { getObservability } from "@skiffr/observability"

export type WatchError = (typeof WATCH_SOURCE_ERRORS)[number]

/**
 * The only error that leaves a fetch of a watched page. A response carries the site's content, so none of it is kept:
 * only a fixed kind, the http status and how long the site asked us to wait.
 */
export class FetchError extends Error {
  override name = "FetchError"
  constructor(
    readonly kind: WatchError,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super("A watched page could not be fetched.")
  }
}

/** The page came back but is not what its kind promises. */
export class ParseError extends Error {
  override name = "ParseError"
  constructor() {
    super("A watched page could not be read.")
  }
}

export function watchErrorOf(error: unknown): WatchError {
  if (error instanceof FetchError) return error.kind
  if (error instanceof ParseError) return "unparseable"
  return "internal"
}

/** What a log line may say about a failed fetch: the source id, the step and the error class, never a url, a header or page content. */
export function logWatchFailure(sourceId: string, error: unknown, extra?: Record<string, string | number>) {
  const fields: Record<string, unknown> = { sourceId, ...extra, kind: watchErrorOf(error) }
  if (error instanceof FetchError && error.status) fields.status = error.status
  console.error("[watch] fetch failed", fields)
  const obs = getObservability()
  const kind = watchErrorOf(error)
  obs.count("skiffr.sync.failures", 1, { job: "watch", error_kind: kind })
  // A page that is gone or unreadable is the site's: counted above. Only our own faults page us.
  if (kind === "internal") obs.captureError(error, { job: "watch", source_id: sourceId, error_kind: kind })
}
