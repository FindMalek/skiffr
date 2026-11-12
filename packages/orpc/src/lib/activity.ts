import { ACTIVITY_WINDOW_DAYS, APPLICATION_STATUSES } from "@skiffr/common/constants"
import type { ActivityEvent, ActivityKind } from "@skiffr/common/schemas"
import { displayText, linkHost } from "@skiffr/common/utils"
import { answer, apiToken, application, type Db, fieldEvent, gmailAccount, job, jobSource } from "@skiffr/db"
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, ne, type SQL, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import { unionAll } from "drizzle-orm/pg-core"
import { z } from "zod"

const DAY_MS = 86_400_000
const HOUR_S = 3_600
const TEXT_MAX = 120

export type Cursor = { at: number; kind: string; key: string }

const cursorSchema = z.object({ at: z.number().int(), kind: z.string().max(40), key: z.string().max(80) })

export const encodeCursor = (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor)).toString("base64url")

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The earliest moment the feed shows: `since`, but never further back than the window. */
export function feedStart(now: Date, since: string | undefined): Date {
  const floor = now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS
  return new Date(Math.max(floor, since ? new Date(since).getTime() : floor))
}

/** Whole milliseconds, so a cursor made in JS compares exactly with a column that holds microseconds. */
const ms = (column: PgColumn) => sql<number>`floor(extract(epoch from ${column}) * 1000)::float8`
const bucketMs = (column: PgColumn) =>
  sql<number>`(floor(extract(epoch from ${column}) / ${sql.raw(String(HOUR_S))}) * ${sql.raw(String(HOUR_S * 1000))})::float8`

/** The rows that sort after the cursor in the order `at desc, kind asc, key desc`. Kinds and keys compare in the C collation. */
function after(cursor: Cursor | null, kind: string, at: SQL<number>, key: SQL<string>): SQL | undefined {
  if (!cursor) return undefined
  if (kind > cursor.kind) return sql`${at} <= ${cursor.at}`
  if (kind < cursor.kind) return sql`${at} < ${cursor.at}`
  return sql`(${at} < ${cursor.at} or (${at} = ${cursor.at} and ${key} < ${cursor.key}))`
}

const text = (value: SQL | PgColumn | string) => sql<string>`(${value})::text collate "C"`
const none = sql<string | null>`null::text`
const kindOf = (kind: ActivityKind) => sql<string>`${sql.raw(`'${kind}'`)}::text collate "C"`
const zero = sql<number>`0::int`

/**
 * One select per kind of event, all with the same columns, so a single `union all` orders and cuts the whole feed.
 * `a`, `b` and `c` carry the text of the event (see `toEvent`). Every leg is limited on its own too: one busy kind can't
 * make the query read more than a page of rows. The values of answers and fields are never selected.
 */
function legs(db: Db, userId: string, since: Date, now: Date, cursor: Cursor | null, take: number) {
  const row = (
    kind: ActivityKind,
    at: SQL<number>,
    key: SQL<string>,
    a: SQL<string | null> = none,
    b: SQL<string | null> = none,
    c: SQL<string | null> = none,
    n: SQL<number> = zero,
  ) => ({
    kind: kindOf(kind).as("kind"),
    at: at.as("at"),
    key: key.as("key"),
    a: a.as("a"),
    b: b.as("b"),
    c: c.as("c"),
    n: n.as("n"),
  })
  const paged = (kind: ActivityKind, at: SQL<number>, key: SQL<string>) => after(cursor, kind, at, key)

  const stage = (name: (typeof APPLICATION_STATUSES)[number], column: PgColumn) => {
    const at = ms(column)
    const key = text(sql`${application.id}::text || ${`:${name}`}`)
    return db
      .select(row("application_stage", at, key, text(job.title), text(job.company), text(name)))
      .from(application)
      .innerJoin(job, eq(job.id, application.jobId))
      .where(and(eq(application.userId, userId), gte(column, since), paged("application_stage", at, key)))
      .orderBy(desc(at), desc(key))
      .limit(take)
  }

  const queuedAt = bucketMs(job.queuedAt)
  const queuedKey = text(sql`md5(${job.source})`)
  const filledAt = bucketMs(fieldEvent.createdAt)
  const filledKey = text(sql`md5(${fieldEvent.siteKey})`)
  const appliedAt = ms(application.appliedAt)
  const appliedKey = text(sql`${application.id}::text`)
  const learnedAt = ms(answer.createdAt)
  const learnedKey = text(sql`${answer.id}::text`)
  const correctedAt = ms(answer.lastCorrectedAt)
  const gmailAt = ms(gmailAccount.updatedAt)
  const gmailKey = text(sql`${gmailAccount.id}::text`)
  const sourceAt = ms(jobSource.lastCheckedAt)
  const sourceKey = text(sql`${jobSource.id}::text`)
  const tokenAt = ms(apiToken.expiresAt)
  const tokenKey = text(sql`${apiToken.id}::text`)

  return [
    db
      .select(row("jobs_queued", queuedAt, queuedKey, text(job.source), none, none, sql<number>`count(*)::int`))
      .from(job)
      .where(and(eq(job.userId, userId), gte(job.queuedAt, since)))
      .groupBy(queuedAt, job.source)
      .having(paged("jobs_queued", queuedAt, queuedKey))
      .orderBy(desc(queuedAt), desc(queuedKey))
      .limit(take),
    db
      .select(row("job_applied", appliedAt, appliedKey, text(job.title), text(job.company)))
      .from(application)
      .innerJoin(job, eq(job.id, application.jobId))
      .where(
        and(
          eq(application.userId, userId),
          gte(application.appliedAt, since),
          paged("job_applied", appliedAt, appliedKey),
        ),
      )
      .orderBy(desc(appliedAt), desc(appliedKey))
      .limit(take),
    stage("responded", application.respondedAt),
    stage("interview", application.interviewAt),
    stage("offer", application.offerAt),
    stage("rejected", application.rejectedAt),
    db
      .select(row("answer_learned", ms(answer.createdAt), learnedKey, text(answer.rawLabel)))
      .from(answer)
      .where(
        and(
          eq(answer.userId, userId),
          eq(answer.source, "autofill"),
          ne(answer.status, "rejected"),
          gte(answer.createdAt, since),
          paged("answer_learned", learnedAt, learnedKey),
        ),
      )
      .orderBy(desc(learnedAt), desc(learnedKey))
      .limit(take),
    db
      .select(row("answer_corrected", correctedAt, learnedKey, text(answer.rawLabel)))
      .from(answer)
      .where(
        and(
          eq(answer.userId, userId),
          ne(answer.status, "rejected"),
          gte(answer.lastCorrectedAt, since),
          lt(answer.createdAt, since),
          paged("answer_corrected", correctedAt, learnedKey),
        ),
      )
      .orderBy(desc(correctedAt), desc(learnedKey))
      .limit(take),
    db
      .select(
        row("fields_filled", filledAt, filledKey, text(fieldEvent.siteKey), none, none, sql<number>`count(*)::int`),
      )
      .from(fieldEvent)
      .where(and(eq(fieldEvent.userId, userId), gte(fieldEvent.createdAt, since)))
      .groupBy(filledAt, fieldEvent.siteKey)
      .having(paged("fields_filled", filledAt, filledKey))
      .orderBy(desc(filledAt), desc(filledKey))
      .limit(take),
    db
      .select(row("gmail_failed", gmailAt, gmailKey, text(gmailAccount.lastError), text(gmailAccount.status)))
      .from(gmailAccount)
      .where(
        and(
          eq(gmailAccount.userId, userId),
          isNotNull(gmailAccount.lastError),
          gte(gmailAccount.updatedAt, since),
          paged("gmail_failed", gmailAt, gmailKey),
        ),
      )
      .orderBy(desc(gmailAt), desc(gmailKey))
      .limit(take),
    db
      .select(
        row(
          "source_failed",
          sourceAt,
          sourceKey,
          text(jobSource.label),
          text(jobSource.url),
          text(sql`coalesce(${jobSource.lastError}, '')`),
        ),
      )
      .from(jobSource)
      .where(
        and(
          eq(jobSource.userId, userId),
          eq(jobSource.status, "error"),
          gte(jobSource.lastCheckedAt, since),
          paged("source_failed", sourceAt, sourceKey),
        ),
      )
      .orderBy(desc(sourceAt), desc(sourceKey))
      .limit(take),
    db
      .select(row("token_expired", tokenAt, tokenKey, text(apiToken.name)))
      .from(apiToken)
      .where(
        and(
          eq(apiToken.userId, userId),
          isNull(apiToken.revokedAt),
          gte(apiToken.expiresAt, since),
          lte(apiToken.expiresAt, now),
          paged("token_expired", tokenAt, tokenKey),
        ),
      )
      .orderBy(desc(tokenAt), desc(tokenKey))
      .limit(take),
  ] as const
}

export type FeedRow = {
  kind: string
  at: number
  key: string
  a: string | null
  b: string | null
  c: string | null
  n: number
}

/** The next `take` events after the cursor, newest first. Ties on the same millisecond sort by kind, then key. */
export async function feedRows(
  db: Db,
  userId: string,
  window: { since: Date; now: Date },
  cursor: Cursor | null,
  take: number,
): Promise<FeedRow[]> {
  const [first, ...rest] = legs(db, userId, window.since, window.now, cursor, take)
  return unionAll(first, ...rest)
    .orderBy(sql`"at" desc, "kind" asc, "key" desc`)
    .limit(take) as unknown as Promise<FeedRow[]>
}

const show = (value: string | null) => displayText(value ?? "", TEXT_MAX)
const STAGES = new Set<string>(APPLICATION_STATUSES)

/** A row to its event. Every piece of text is page or email text, so it is neutralized here and the client only renders it as text. */
export function toEvent(row: FeedRow): ActivityEvent | null {
  const base = { id: `${row.kind}:${row.at}:${row.key}`, at: new Date(row.at) }
  switch (row.kind) {
    case "jobs_queued":
      return { ...base, kind: "jobs_queued", source: show(row.a), count: row.n }
    case "job_applied":
      return { ...base, kind: "job_applied", title: show(row.a), company: show(row.b) }
    case "application_stage":
      return row.c && STAGES.has(row.c)
        ? {
            ...base,
            kind: "application_stage",
            stage: row.c as (typeof APPLICATION_STATUSES)[number],
            title: show(row.a),
            company: show(row.b),
          }
        : null
    case "answer_learned":
      return { ...base, kind: "answer_learned", label: show(row.a) }
    case "answer_corrected":
      return { ...base, kind: "answer_corrected", label: show(row.a) }
    case "fields_filled":
      return { ...base, kind: "fields_filled", site: show(row.a), count: row.n }
    case "gmail_failed":
      return { ...base, kind: "gmail_failed", code: show(row.a), needsReconnect: row.b === "needs_reconnect" }
    case "source_failed":
      return {
        ...base,
        kind: "source_failed",
        source: show(row.a || (row.b ? (linkHost(row.b) ?? "") : "")),
        code: show(row.c),
      }
    case "token_expired":
      return { ...base, kind: "token_expired", name: show(row.a) }
    default:
      return null
  }
}
