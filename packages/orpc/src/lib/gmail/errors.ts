export type GoogleErrorKind =
  /** 401, or a refresh token Google no longer accepts (`invalid_grant`): the user has to connect again. */
  | "auth"
  /** 403: the grant lacks the scope we need, or the Gmail API is off for the client. */
  | "scope"
  | "rate"
  | "server"
  | "network"
  | "too_large"
  | "client"

/**
 * The only error that leaves a Google call. Responses carry mail and tokens, so none of a response is kept: only the
 * kind, the http status and how long Google asked us to wait.
 */
export class GoogleError extends Error {
  override name = "GoogleError"
  constructor(
    readonly kind: GoogleErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super("A Google call failed.")
  }
}

/** The fixed codes stored in `gmail_account.last_error`, shown to the user, and safe to log. */
export const SYNC_ERRORS = ["auth", "scope", "rate_limited", "upstream", "network", "internal"] as const
export type SyncError = (typeof SYNC_ERRORS)[number]

export function syncErrorOf(error: unknown): SyncError {
  if (error instanceof GoogleError) {
    switch (error.kind) {
      case "auth":
        return "auth"
      case "scope":
        return "scope"
      case "rate":
        return "rate_limited"
      case "server":
        return "upstream"
      case "network":
        return "network"
      default:
        return "upstream"
    }
  }
  return "internal"
}

/** What a log line may say about a failed sync: the account id and codes, never a token, address or email text. */
export function logSyncFailure(accountId: string, error: unknown, extra?: Record<string, string | number>) {
  const fields: Record<string, unknown> = { accountId, ...extra }
  if (error instanceof GoogleError) Object.assign(fields, { kind: error.kind, status: error.status })
  else fields.name = error instanceof Error && /^[A-Za-z0-9_]{1,40}$/.test(error.name) ? error.name : "Error"
  console.error("[gmail] sync failed", fields)
}
