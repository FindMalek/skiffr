import {
  ANSWER_STATUSES,
  EMBEDDING_DIMENSIONS,
  FIELD_EVENT_OUTCOMES,
  FIELD_EVENT_SOURCES,
} from "@skiffr/common/constants"
import type { ProfileData, ProfileFields, SiteFieldMap } from "@skiffr/common/schemas"
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
 * asking a model. `form_signature` is the hash of the form's sorted field fingerprints, `fingerprints` those fingerprints
 * (a changed form is matched by their overlap) and `field_map` the learned value per fingerprint. The values are the
 * user's own data: never log them.
 */
export const siteProfile = pgTable(
  "site_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    siteKey: text("site_key").notNull(),
    formSignature: text("form_signature").notNull(),
    fingerprints: jsonb("fingerprints").$type<string[]>().notNull(),
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
