/** Confidence at or above this fills quietly. */
export const FILL_CONFIDENCE_REVIEW = 0.7
/** Below this a mapping is dropped. Between the two the field is filled and outlined for review. */
export const FILL_CONFIDENCE_MIN = 0.4
/** Learned answers are what the person typed before (`site`: on this very form), so they rank above any model guess. */
export const LEARNED_CONFIDENCE = { site: 1, exact: 1, label: 0.9 } as const

/** The reason a learned answer carries in the mapping, so the learning session can tell where a filled value came from. */
export const savedAnswerReason = (source: string): string => `saved answer (${source})`

export const FILL_FIELDS_MAX = 300
export const PROFILE_TTL_MS = 60_000
export const CALL_TIMEOUT_MS = { lookup: 8_000, profile: 8_000, mapFields: 30_000 } as const
/** One budget for all calls of a request, retries and batches included, so a hanging api is not minutes of "Filling…". */
export const REQUEST_DEADLINE_MS = 45_000
/** The shared profile read has its own budget: two tries and the pause between them. */
export const PROFILE_READ_DEADLINE_MS = 20_000
export const RETRY_BACKOFF_MS = 600
export const REQUEST_LIMIT = { max: 10, windowMs: 60_000 } as const
export const RECORD_LIMIT = { max: 12, windowMs: 60_000 } as const
export const RECORD_TIMEOUT_MS = 15_000
export const NEXT_LIMIT = { max: 12, windowMs: 60_000 } as const
export const NEXT_TIMEOUT_MS = 10_000
/** How many of the oldest queued jobs are read to find the submitted one and the next one. */
export const NEXT_JOBS_MAX = 100
/** An offer that was not answered is shown once more on the page the submit led to, if it comes this soon and is on the same site. */
export const NEXT_REPLAY_MS = 120_000
/** The longest an offer can be answered, however long the person was away: after this the choices are gone. */
export const NEXT_OFFER_MAX_MS = 600_000
export const NEXT_TOAST_MS = 30_000
/** A fill session with no edit for this long is sent as it stands. */
export const LEARNING_IDLE_MS = 300_000
/** A session sends at most this many batches: a first one, then follow-ups for edits made since. */
export const LEARNING_BATCHES_MAX = 3
/** Pauses before each resend of a batch that failed for a reason worth repeating. */
export const LEARNING_RETRY_DELAYS_MS = [2_000, 10_000] as const
/** How long a content script waits for the worker before it gives up on a fill. */
export const ROUND_TRIP_TIMEOUT_MS = 60_000

export const FILL_ERROR_CODES = [
  "not-configured",
  "rejected",
  "unavailable",
  "no-ai-key",
  "unreachable",
  "timeout",
  "no-profile",
  "busy",
  "budget",
  "invalid",
  "changed",
  "failed",
] as const
export type FillErrorCode = (typeof FILL_ERROR_CODES)[number]

/** What the in-page result says for each failure. */
export const FILL_ERROR_TEXT: Record<FillErrorCode, string> = {
  "not-configured": "skiffr is not connected yet. Add your token in the settings.",
  rejected: "skiffr no longer accepts this connection. It may have been revoked: reconnect in the settings.",
  unavailable: "skiffr had a problem. Try again in a moment.",
  "no-ai-key": "The skiffr server has no AI key yet. Ask whoever runs it to set GROQ_API_KEY or OPENAI_API_KEY.",
  unreachable: "Could not reach skiffr. Check your connection or the server address in settings.",
  timeout: "skiffr took too long to answer. Try again.",
  "no-profile": "No profile saved yet. Fill in your profile in the dashboard first.",
  busy: "Too many fill requests in a row. Wait a moment and try again.",
  budget: "The daily AI limit on this server is used up. It resets at midnight UTC.",
  invalid: "This page could not be filled.",
  changed: "The page or your settings changed while filling. Try again.",
  failed: "Something went wrong while filling. Try again.",
}

export const FILL_ERROR_ACTIONS: Record<FillErrorCode, readonly ("settings" | "retry")[]> = {
  "not-configured": ["settings"],
  rejected: ["settings"],
  unavailable: ["retry"],
  "no-ai-key": [],
  unreachable: ["retry", "settings"],
  timeout: ["retry"],
  "no-profile": [],
  busy: ["retry"],
  budget: [],
  invalid: [],
  changed: ["retry"],
  failed: ["retry"],
}
