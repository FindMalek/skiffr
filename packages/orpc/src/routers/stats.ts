import { MATCH_BUCKETS, STATS_SOURCES_SHOWN, STATS_TOP } from "@skiffr/common/constants"
import { statsOverviewInputSchema, statsOverviewSchema } from "@skiffr/common/schemas"
import { application, fieldEvent, job } from "@skiffr/db"
import { and, asc, desc, eq, gte, type SQL, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import { dayKey, fillDays, groupWeeks, matchBucket, rangeStart, TIME_BUCKETS } from "../lib/stats"
import { protectedProcedure } from "../procedures"

const n = (expr: SQL) => sql<number>`${expr}::int`
const utcDay = (column: PgColumn) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`

const responded = sql`(${application.respondedAt} is not null or ${application.interviewAt} is not null or ${application.offerAt} is not null or ${application.rejectedAt} is not null)`
const interviewed = sql`(${application.interviewAt} is not null or ${application.offerAt} is not null)`
const offered = sql`${application.offerAt} is not null`

/** An application counts at every stage it passed, so each stage is a subset of the one before. */
const stageCounts = {
  applied: n(sql`count(*)`),
  responded: n(sql`count(*) filter (where ${responded})`),
  interview: n(sql`count(*) filter (where ${interviewed})`),
  offer: n(sql`count(*) filter (where ${offered})`),
}

const secondsToApply = sql`greatest(extract(epoch from (${application.appliedAt} - ${job.queuedAt})), 0)`
const HOUR = 3_600
const DAY = 24 * HOUR

export const statsRouter = {
  overview: protectedProcedure
    .route({
      method: "GET",
      path: "/stats",
      summary:
        "Applications per day and week, the queue and response funnels, time to apply and autofill accuracy over the last 7, 30 or 90 UTC days",
      tags: ["stats"],
    })
    .input(statsOverviewInputSchema)
    .output(statsOverviewSchema)
    .handler(async ({ context, input }) => {
      const now = context.now()
      const from = rangeStart(now, input.days)
      const userId = context.user.id
      const applied = and(eq(application.userId, userId), gte(application.appliedAt, from))
      const queued = and(eq(job.userId, userId), gte(job.queuedAt, from))
      const filled = and(eq(fieldEvent.userId, userId), gte(fieldEvent.createdAt, from))
      const grouped = (key: SQL, label: SQL<string>) =>
        context.db
          .select({ key: label, ...stageCounts })
          .from(application)
          .innerJoin(job, eq(job.id, application.jobId))
          .where(applied)
          .groupBy(key)
          .orderBy(desc(stageCounts.applied), asc(key))
          .limit(STATS_TOP)
      const outcome = (name: string) => n(sql`count(*) filter (where ${fieldEvent.outcome} = ${name})`)

      const [days, jobRows, sourceRows, stageRow, atsRows, roleRows, scoreRows, timing, fieldRows, formRows] =
        await Promise.all([
          context.db
            .select({ day: utcDay(application.appliedAt), count: n(sql`count(*)`) })
            .from(application)
            .where(applied)
            .groupBy(utcDay(application.appliedAt)),
          context.db
            .select({ status: job.status, count: n(sql`count(*)`) })
            .from(job)
            .where(queued)
            .groupBy(job.status),
          context.db
            .select({
              source: job.source,
              queued: n(sql`count(*) filter (where ${job.status} = 'queued')`),
              applied: n(sql`count(*) filter (where ${job.status} = 'applied')`),
              skipped: n(sql`count(*) filter (where ${job.status} = 'skipped')`),
            })
            .from(job)
            .where(queued)
            .groupBy(job.source),
          context.db.select(stageCounts).from(application).where(applied),
          grouped(sql`lower(${application.ats})`, sql`min(${application.ats})`),
          grouped(sql`lower(btrim(${job.title}))`, sql`min(${job.title})`),
          context.db
            .select({ score: application.matchScore, ...stageCounts })
            .from(application)
            .where(applied)
            .groupBy(application.matchScore),
          context.db
            .select({
              count: n(sql`count(*)`),
              median: sql<number | null>`percentile_cont(0.5) within group (order by ${secondsToApply})`,
              day: n(sql`count(*) filter (where ${secondsToApply} < ${DAY})`),
              three: n(sql`count(*) filter (where ${secondsToApply} >= ${DAY} and ${secondsToApply} < ${3 * DAY})`),
              week: n(sql`count(*) filter (where ${secondsToApply} >= ${3 * DAY} and ${secondsToApply} < ${7 * DAY})`),
              over: n(sql`count(*) filter (where ${secondsToApply} >= ${7 * DAY})`),
            })
            .from(application)
            .innerJoin(job, eq(job.id, application.jobId))
            .where(applied),
          context.db
            .select({
              source: fieldEvent.source,
              fields: n(sql`count(*)`),
              accepted: outcome("accepted"),
              corrected: outcome("corrected"),
              cleared: outcome("cleared"),
            })
            .from(fieldEvent)
            .where(filled)
            .groupBy(fieldEvent.source)
            .orderBy(asc(fieldEvent.source)),
          context.db
            .select({ forms: n(sql`count(distinct ${fieldEvent.applicationId})`) })
            .from(fieldEvent)
            .where(filled),
        ])

      const perDay = fillDays(from, now, new Map(days.map((row) => [row.day, row.count])))

      const status = { queued: 0, applied: 0, skipped: 0 }
      for (const row of jobRows) status[row.status] = row.count

      const total = (row: { queued: number; applied: number; skipped: number }) =>
        row.queued + row.applied + row.skipped
      const ranked = sourceRows.sort((a, b) => total(b) - total(a) || a.source.localeCompare(b.source))
      const tail = ranked.slice(STATS_SOURCES_SHOWN)
      const otherSources = tail.length
        ? {
            queued: tail.reduce((sum, row) => sum + row.queued, 0),
            applied: tail.reduce((sum, row) => sum + row.applied, 0),
            skipped: tail.reduce((sum, row) => sum + row.skipped, 0),
          }
        : null

      const byBucket = new Map<string, { applied: number; responded: number; interview: number; offer: number }>()
      for (const row of scoreRows) {
        const key = matchBucket(row.score)
        const sum = byBucket.get(key) ?? { applied: 0, responded: 0, interview: 0, offer: 0 }
        byBucket.set(key, {
          applied: sum.applied + row.applied,
          responded: sum.responded + row.responded,
          interview: sum.interview + row.interview,
          offer: sum.offer + row.offer,
        })
      }
      const empty = { applied: 0, responded: 0, interview: 0, offer: 0 }
      const byMatch = [
        ...MATCH_BUCKETS.map((bucket) => ({ key: bucket.key, ...(byBucket.get(bucket.key) ?? empty) })),
        ...(byBucket.has("none") ? [{ key: "none", ...byBucket.get("none")! }] : []),
      ]

      const time = timing[0]
      const sum = (pick: (row: (typeof fieldRows)[number]) => number) => fieldRows.reduce((s, row) => s + pick(row), 0)

      return {
        days: input.days,
        from: dayKey(from),
        to: dayKey(now),
        perDay,
        perWeek: groupWeeks(perDay),
        jobs: status,
        bySource: ranked.slice(0, STATS_SOURCES_SHOWN),
        otherSources,
        stages: stageRow[0] ?? empty,
        byAts: atsRows,
        byRole: roleRows,
        byMatch,
        timeToApply: {
          count: time?.count ?? 0,
          medianHours: time?.median == null ? null : Math.round((Number(time.median) / HOUR) * 10) / 10,
          buckets: [time?.day, time?.three, time?.week, time?.over].map((count, i) => ({
            key: TIME_BUCKETS[i]!,
            count: count ?? 0,
          })),
        },
        autofill: {
          fields: sum((row) => row.fields),
          accepted: sum((row) => row.accepted),
          corrected: sum((row) => row.corrected),
          cleared: sum((row) => row.cleared),
          forms: formRows[0]?.forms ?? 0,
          bySource: fieldRows,
        },
      }
    }),
}
