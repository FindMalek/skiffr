export type CvErrorKind =
  /** 401: the key is wrong or revoked. */
  | "auth"
  /** 403: the key can't do this, for example a read-only key asked to write. */
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream"
  | "network"
  /** The address is not a public one, so it was not called. */
  | "blocked"
  | "too_large"
  | "invalid_resume"
  | "bad_request"
  | "not_connected"
  | "no_base"

/**
 * The only error that leaves a Reactive Resume call. A response holds the resume and an error may echo the key, so none
 * of it is kept: a fixed kind and the http status.
 */
export class CvError extends Error {
  override name = "CvError"
  constructor(
    readonly kind: CvErrorKind,
    readonly status?: number,
  ) {
    super("A Reactive Resume call failed.")
  }
}

/** What a log line may say about a failed call: the route and a fixed kind, never the address, the key or any content. */
export function logCvFailure(route: string, error: unknown) {
  console.error("[cv] failed", {
    route,
    kind: error instanceof CvError ? error.kind : "internal",
    status: error instanceof CvError ? error.status : undefined,
  })
}
