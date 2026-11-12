import {
  ANSWER_STATUSES,
  EMBEDDING_DIMENSIONS,
  FIELD_EVENT_OUTCOMES,
  FIELD_EVENT_SOURCES,
  GMAIL_ACCOUNT_STATUSES,
  GMAIL_MESSAGE_OUTCOMES,
} from "@skiffr/common/constants"
import type { ProfileData, ProfileFields, RecordOutput, SiteFieldMap } from "@skiffr/common/schemas"
import { getTableColumns } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core"
import { user } from "./auth"

const userId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()

export const answerSource = pgEnum("answer_source", ["manual", "autofill", "ai", "import"])
/** `learned` came from the user's own corrections, `confirmed` is kept as their default, `rejected` is never filled or suggested again. */
export const answerStatus = pgEnum("answer_status", ANSWER_STATUSES)
export const fieldEventSource = pgEnum("field_event_source", FIELD_EVENT_SOURCES)
export const fieldEventOutcome = pgEnum("field_event_outcome", FIELD_EVENT_OUTCOMES)
export const jobStatus = pgEnum("job_status", ["queued", "applied", "skipped"])
export const gmailAccountStatus = pgEnum("gmail_account_status", GMAIL_ACCOUNT_STATUSES)
export const gmailMessageOutcome = pgEnum("gmail_message_outcome", GMAIL_MESSAGE_OUTCOMES)
export const applicationStatus = pgEnum("application_status", [
  "applied",
  "responded",
  "interview",
  "offer",
  "rejected",
])

/** One per user: `data` is the typed identity, links, work auth, salary and location; `fields` is normalized label → value for the rest. */
export const profile = pgTable("profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userId().unique(),
  data: jsonb("data").$type<ProfileData>().notNull(),
  fields: jsonb("fields").$type<ProfileFields>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const answer = pgTable(
  "answer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    normalizedLabel: text("normalized_label").notNull(),
    rawLabel: text("raw_label").notNull(),
    value: text("value").notNull(),
    source: answerSource("source").notNull().default("manual"),
    timesUsed: integer("times_used").notNull().default(0),
    timesCorrected: integer("times_corrected").notNull().default(0),
    /** Clears of this value in a row: any accept or correction resets it. */
    timesCleared: integer("times_cleared").notNull().default(0),
    status: answerStatus("status").notNull().default("learned"),
    lastCorrectedAt: timestamp("last_corrected_at", { withTimezone: true }),
    /** Fingerprint of the field this value was last learned on: label, type and options. */
    fingerprint: text("fingerprint"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("answer_user_label_unique").on(t.userId, t.normalizedLabel),
    index("answer_user_fingerprint_idx").on(t.userId, t.fingerprint),
  ],
)

const { embedding: _embedding, ...answerPublicColumns } = getTableColumns(answer)
/** Every answer column except the embedding, which never leaves the server. Use it for selects and returning. */
export const answerColumns = answerPublicColumns

export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    url: text("url").notNull(),
    canonicalId: text("canonical_id").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    source: text("source").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("job_user_canonical_unique").on(t.userId, t.canonicalId),
    index("job_user_status_queued_idx").on(t.userId, t.status, t.queuedAt.desc().nullsFirst()),
  ],
)

export const application = pgTable(
  "application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    jobId: uuid("job_id")
      .notNull()
      .unique()
      .references(() => job.id, { onDelete: "cascade" }),
    ats: text("ats").notNull(),
    resumeId: text("resume_id"),
    matchScore: integer("match_score"),
    status: applicationStatus("status").notNull().default("applied"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    interviewAt: timestamp("interview_at", { withTimezone: true }),
    offerAt: timestamp("offer_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("application_user_status_idx").on(t.userId, t.status)],
)

/** What the extension filled and what the user left in the field. Both values are the user's own data: never log them. */
export const fieldEvent = pgTable(
  "field_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    applicationId: uuid("application_id").references(() => application.id, { onDelete: "set null" }),
    /** Host, or host and first path segment on multi-tenant ATS hosts. */
    siteKey: text("site_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    rawLabel: text("raw_label").notNull(),
    fieldType: text("field_type").notNull().default(""),
    filledValue: text("filled_value").notNull(),
    finalValue: text("final_value").notNull(),
    source: fieldEventSource("source").notNull(),
    outcome: fieldEventOutcome("outcome").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("field_event_user_label_idx").on(t.userId, t.normalizedLabel, t.createdAt.desc()),
    index("field_event_user_created_idx").on(t.userId, t.createdAt),
    index("field_event_application_idx").on(t.applicationId),
  ],
)

/**
 * What the user left in each field the last time they filled one form of a site, so the next visit fills the same without
 * asking a model. A field is identified by its label and control type (not its options). `form_signature` is the hash of
 * the form's sorted field keys, `field_keys` those keys (a changed form is matched by their overlap) and `field_map` the
 * learned value per key. The values are the
 * user's own data: never log them.
 */
export const siteProfile = pgTable(
  "site_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    siteKey: text("site_key").notNull(),
    formSignature: text("form_signature").notNull(),
    fieldKeys: jsonb("field_keys").$type<string[]>().notNull(),
    fieldMap: jsonb("field_map").$type<SiteFieldMap>().notNull().default({}),
    timesUsed: integer("times_used").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("site_profile_user_site_form_unique").on(t.userId, t.siteKey, t.formSignature),
    index("site_profile_user_last_used_idx").on(t.userId, t.lastUsedAt),
  ],
)

/** Batches of events already applied, so a retried `learning.record` changes nothing the second time. */
export const recordBatch = pgTable(
  "record_batch",
  {
    userId: userId(),
    batchId: uuid("batch_id").notNull(),
    /** Hash of the batch's content, so the same id with different events is refused instead of silently ignored. */
    payloadHash: text("payload_hash").notNull(),
    /** What the first attempt answered (counts and statuses only), so a replay answers the same. Null for a batch still running. */
    response: jsonb("response").$type<RecordOutput>(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.batchId] })],
)

/** A careers page the user watches for new postings. */
export const jobSource = pgTable(
  "job_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    url: text("url").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique("job_source_user_url_unique").on(t.userId, t.url)],
)

/** Personal access tokens for the extension. Only the sha-256 of the secret is stored; `prefix` and `last4` are for display. */
export const apiToken = pgTable(
  "api_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    last4: text("last4").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_token_user_idx").on(t.userId)],
)

/**
 * The user's connected Gmail mailbox, one per user and one skiffr user per mailbox. `refresh_token_enc` is the refresh token
 * sealed with AES-256-GCM (see `lib/gmail/crypto.ts`): it is never selected into a response and never logged.
 */
export const gmailAccount = pgTable(
  "gmail_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId().unique(),
    email: text("email").notNull().unique(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scopes: text("scopes").notNull(),
    status: gmailAccountStatus("status").notNull().default("active"),
    /** Id of the `skiffr/jobs` label in this mailbox. */
    labelId: text("label_id"),
    /** Addresses (`jobs@site.com`) and domains (`@site.com`) whose unread mail is read. */
    senders: jsonb("senders").$type<string[]>().notNull().default([]),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    /** A fixed code (`auth`, `rate_limited`, ...), never a message from Google or anything from an email. */
    lastError: text("last_error"),
    /** Backoff: the scheduler leaves the account alone until then. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /** Held while a sync runs, so two replicas or a click and the scheduler never run one mailbox at once. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastManualSyncAt: timestamp("last_manual_sync_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("gmail_account_status_idx").on(t.status)],
)

/**
 * Every email already looked at, so a message is read once whatever happens next. It holds ids and counts only: no
 * subject, sender or body. `modified_at` stays null until the mailbox was tidied (read, out of the inbox, labelled).
 */
export const gmailMessage = pgTable(
  "gmail_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => gmailAccount.id, { onDelete: "cascade" }),
    googleMessageId: text("google_message_id").notNull(),
    /** `linkedin`, `indeed`, ... or `other`: the job `source` is `gmail:<provider>`. */
    provider: text("provider").notNull(),
    outcome: gmailMessageOutcome("outcome").notNull(),
    jobsFound: integer("jobs_found").notNull().default(0),
    jobsNew: integer("jobs_new").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
  },
  (t) => [
    unique("gmail_message_user_message_unique").on(t.userId, t.googleMessageId),
    index("gmail_message_account_processed_idx").on(t.accountId, t.processedAt.desc()),
  ],
)

/** Which jobs a message added to the queue, for the "imported from" list. */
export const gmailMessageJob = pgTable(
  "gmail_message_job",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => gmailMessage.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.jobId] })],
)

/** A consent flow in progress: single use (deleted when the callback consumes it) and short lived. */
export const gmailOauthState = pgTable(
  "gmail_oauth_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    /** sha-256 of the random part of `state`: the state itself is never stored. */
    stateHash: text("state_hash").notNull().unique(),
    /** The PKCE verifier, sealed like the refresh token. */
    codeVerifierEnc: text("code_verifier_enc").notNull(),
    returnTo: text("return_to").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("gmail_oauth_state_user_idx").on(t.userId)],
)
