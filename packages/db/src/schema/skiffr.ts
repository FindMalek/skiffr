import type { ProfileData, ProfileFields } from "@skiffr/common/schemas"
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

const userId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()

export const answerSource = pgEnum("answer_source", ["manual", "autofill", "ai", "import"])
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

// The embedding vector(1536) column is a follow-up: the local postgres image (postgres:17-alpine) has no pgvector.
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("answer_user_label_unique").on(t.userId, t.normalizedLabel)],
)

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
    index("job_user_status_queued_idx").on(t.userId, t.status, t.queuedAt.desc()),
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
