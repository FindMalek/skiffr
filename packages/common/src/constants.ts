export const NOTE_TITLE_MAX = 120
export const NOTE_BODY_MAX = 10_000
export const PROFILE_NAME_MAX = 80
export const ADMIN_LIST_LIMIT = 100
export const LABEL_MAX = 300
export const ANSWER_VALUE_MAX = 5_000
export const URL_MAX = 2_048
export const SHORT_TEXT_MAX = 200
export const JOB_STATUSES = ["queued", "applied", "skipped"] as const
export const APPLICATION_STATUSES = ["applied", "responded", "interview", "offer", "rejected"] as const
export const ANSWER_SOURCES = ["manual", "autofill", "ai", "import"] as const
export const LIST_LIMIT_DEFAULT = 100
export const LIST_LIMIT_MAX = 500
export const PROFILE_FIELDS_MAX = 200
export const JOB_SEARCH_MAX = 100
export const JOB_SOURCES_MAX = 50
export const JOB_BULK_MAX = 100
export const STATS_RANGES = [7, 30, 90] as const
export const STATS_DEFAULT_DAYS = 30
/** Rows in the by-ats and by-role tables. */
export const STATS_TOP = 10
/** Sources shown one by one in the funnel; the rest are summed into one row. */
export const STATS_SOURCES_SHOWN = 8
/** A rate over fewer applications than this is not shown: it would only be noise. */
export const STATS_MIN_SAMPLE = 5
/** Match score buckets, lowest first. A score is in the first bucket whose `max` it does not pass. */
export const MATCH_BUCKETS = [
  { key: "0-49", max: 49 },
  { key: "50-69", max: 69 },
  { key: "70-84", max: 84 },
  { key: "85-100", max: 100 },
] as const
export const JOB_SETTABLE_STATUSES = ["queued", "skipped"] as const
/** The `ORPCError` code (status 429) a call gets once the user's daily model budget is spent. */
export const AI_BUDGET_EXHAUSTED = "AI_BUDGET_EXHAUSTED"
export const AI_FIELDS_MAX = 60
export const AI_OPTIONS_MAX = 50
export const AI_OPTION_TEXT_MAX = 100
export const AI_REQUEST_CHARS_MAX = 40_000
export const AI_FIELD_TEXT_MAX = 300
export const AI_QUESTION_MAX = 1_000
export const AI_JOB_DESCRIPTION_MAX = 8_000
export const AI_CORRECTIONS_MAX = 5
export const AI_CORRECTION_TEXT_MAX = 1_500
export const AI_ANSWER_LENGTH_MIN = 50
export const AI_ANSWER_LENGTH_MAX = 2_000
export const AI_ANSWER_LENGTH_DEFAULT = 600
export const AI_GENERATED_VALUE_MAX = 300
export const AI_REASON_MAX = 200
export const TOKEN_NAME_MAX = 60
export const TOKEN_EXPIRY_DAYS_MAX = 365
export const TOKEN_PREFIX = "skp_"
/** Tokens a user can have at once (not revoked, not expired). */
export const TOKEN_ACTIVE_MAX = 20
/** Revoked and expired tokens stay listed this long. */
export const TOKEN_HISTORY_DAYS = 30
export const TOKEN_LIST_MAX = 100
/** Oldest extension version this api still serves. Raise it when a change would break older extensions. */
export const EXTENSION_MIN_VERSION = "0.0.1"
/** An extension that has not been seen for this long reads as stale in the dashboard. */
export const EXTENSION_STALE_HOURS = 24
export const EMBEDDING_DIMENSIONS = 1536
export const EMBEDDING_TEXTS_MAX = 100
export const EMBEDDING_TEXT_MAX = 300
export const ANSWER_STATUSES = ["learned", "confirmed", "rejected"] as const
export const FIELD_EVENT_SOURCES = ["profile", "answer", "ai", "site"] as const
export const FIELD_EVENT_OUTCOMES = ["accepted", "corrected", "cleared"] as const
export const LEARNING_FIELDS_MAX = 60
export const LEARNING_REQUEST_CHARS_MAX = 100_000
export const LEARNING_VALUE_MAX = 2_000
export const SITE_KEY_MAX = 200
/** Cosine similarity a question must reach to be suggested another question's answer. A floor until real numbers are measured (issue #41). */
export const SIMILARITY_MIN = 0.92
/** How far the best match must lead the runner-up, or the lookup stays silent. */
export const SIMILARITY_MARGIN = 0.05
export const SUGGEST_KEEP_MIN = 2
export const SUGGEST_FLIP_FLOP_MIN = 3
export const SUGGEST_STABLE_RUN = 3
export const SUGGEST_WINDOW_DAYS = 90
export const SUGGEST_STALE_DAYS = 180
export const STATS_APPLICATIONS_MAX = 200
export const LEARNING_AUTOFILL_VALUE_MAX = 300
export const CLEARED_STOP_MIN = 3
export const FIELD_EVENT_RETENTION_DAYS = 90
export const FIELD_EVENT_PURGE_BATCH = 500
export const ANSWERS_PER_USER_MAX = 2_000
export const SITE_PROFILES_PER_USER_MAX = 500
/** Saved forms of one site: a busy site can't push the others out, the oldest of its own go first. */
export const SITE_PROFILES_PER_SITE_MAX = 20
export const SITE_PROFILE_RETENTION_DAYS = 180
/** A changed form still uses a site's saved profile when this share of its fields is unchanged (see `lib/site-profile.ts`). */
export const SITE_PROFILE_OVERLAP_MIN = 0.8
/** A record covering less than this share of a known form it is a strict subset of is not saved as a form of its own. */
export const SITE_PROFILE_PARTIAL_MAX = 0.5
export const SITE_FIELD_SOURCES = ["answer", "profile", "literal"] as const
export const GMAIL_ACCOUNT_STATUSES = ["active", "needs_reconnect", "disabled"] as const
export const GMAIL_MESSAGE_OUTCOMES = ["imported", "duplicate", "no_jobs", "skipped", "failed"] as const
export const GMAIL_SENDERS_MAX = 30
export const GMAIL_SENDER_MAX = 120
export const GMAIL_LABEL = "skiffr/jobs"
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify"
export const GMAIL_RECENT_MAX = 50
export const WATCH_SOURCE_KINDS = ["auto", "greenhouse", "lever", "ashby", "workable", "feed", "html"] as const
export const WATCH_SOURCE_STATUSES = ["pending", "ok", "error"] as const
/** The fixed codes stored in `job_source.last_error`, shown to the user, and safe to log. */
export const WATCH_SOURCE_ERRORS = [
  "blocked",
  "dns",
  "network",
  "timeout",
  "too_large",
  "content_type",
  "not_found",
  "rate_limited",
  "upstream",
  "unparseable",
  "internal",
] as const
/** Sources one user can watch. */
export const WATCH_SOURCES_MAX = 20
export const WATCH_LABEL_MAX = 60
export const CV_DEFAULT_URL = "https://rxresu.me"
export const CV_API_KEY_MAX = 256
export const CV_DESCRIPTION_MIN = 40
export const CV_DESCRIPTION_MAX = 12_000
export const CV_RESUMES_MAX = 100
/** A patch bigger than this is refused whole: operations, then bytes of the serialized patch. */
export const CV_PATCH_OPS_MAX = 40
export const CV_PATCH_BYTES_MAX = 24_000
/** Why a single operation of a proposed patch was dropped. Fixed codes, safe to show and to log. */
export const CV_REJECTIONS = [
  "op_not_allowed",
  "path_not_allowed",
  "bad_index",
  "invalid_value",
  "hide_only",
  "unicode",
  "too_long",
  "invented_fact",
  "invented_skill",
] as const
/** The activity feed looks back this many days at most, so one request never scans a whole history. */
export const ACTIVITY_WINDOW_DAYS = 30
export const ACTIVITY_LIMIT_DEFAULT = 30
export const ACTIVITY_LIMIT_MAX = 100
