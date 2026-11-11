/** Confidence at or above this fills quietly. */
export const FILL_CONFIDENCE_REVIEW = 0.7
/** Below this a mapping is dropped. Between the two the field is filled and outlined for review. */
export const FILL_CONFIDENCE_MIN = 0.4
/** Learned answers are what the person typed before (`site`: on this very form), so they rank above any model guess. */
export const LEARNED_CONFIDENCE = { site: 1, exact: 1, label: 0.9 } as const

export const FILL_FIELDS_MAX = 300
export const PROFILE_TTL_MS = 60_000
export const CALL_TIMEOUT_MS = { lookup: 8_000, profile: 8_000, mapFields: 30_000 } as const
export const RETRY_BACKOFF_MS = 600
export const REQUEST_LIMIT = { max: 10, windowMs: 60_000 } as const
/** How long a content script waits for the worker before it gives up on a fill. */
export const ROUND_TRIP_TIMEOUT_MS = 120_000

export const FILL_ERROR_CODES = [
  "not-configured",
  "rejected",
  "unavailable",
  "unreachable",
  "timeout",
  "no-profile",
  "busy",
  "invalid",
  "failed",
] as const
export type FillErrorCode = (typeof FILL_ERROR_CODES)[number]

/** What the in-page result says for each failure. */
export const FILL_ERROR_TEXT: Record<FillErrorCode, string> = {
  "not-configured": "Skiffr is not connected yet. Add your token in the settings.",
  rejected: "Your token was rejected. It may be revoked: reconnect in the settings.",
  unavailable: "The Skiffr API had a problem. Try again in a moment.",
  unreachable: "Could not reach the Skiffr API. Check your connection and the API url.",
  timeout: "The Skiffr API took too long to answer. Try again.",
  "no-profile": "No profile saved yet. Fill in your profile in the dashboard first.",
  busy: "Too many fill requests in a row. Wait a moment and try again.",
  invalid: "This page could not be filled.",
  failed: "Something went wrong while filling. Try again.",
}

export const FILL_ERROR_ACTIONS: Record<FillErrorCode, readonly ("settings" | "retry")[]> = {
  "not-configured": ["settings"],
  rejected: ["settings"],
  unavailable: ["retry"],
  unreachable: ["retry", "settings"],
  timeout: ["retry"],
  "no-profile": [],
  busy: ["retry"],
  invalid: [],
  failed: ["retry"],
}
