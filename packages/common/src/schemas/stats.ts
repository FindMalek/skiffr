import { z } from "zod"
import { STATS_DEFAULT_DAYS, STATS_RANGES } from "../constants"
import { queryInt } from "./query"

export const statsOverviewInputSchema = z
  .object({
    days: queryInt(z.number().int()).pipe(z.literal(STATS_RANGES)).default(STATS_DEFAULT_DAYS),
  })
  .prefault({})

const count = z.number().int().nonnegative()
const day = z.string()

const stages = { applied: count, responded: count, interview: count, offer: count }

const groupSchema = z.object({ key: z.string(), ...stages })
const sourceSchema = z.object({ source: z.string(), queued: count, applied: count, skipped: count })
const autofillSchema = z.object({ fields: count, accepted: count, corrected: count, cleared: count })

export const statsOverviewSchema = z.object({
  days: z.number(),
  /** First and last UTC day of the range, `YYYY-MM-DD`. */
  from: day,
  to: day,
  perDay: z.array(z.object({ day, count })),
  /** Weeks start on Monday (UTC). The first week only counts the days inside the range. */
  perWeek: z.array(z.object({ week: day, count })),
  /** Jobs queued in the range, by their status now. */
  jobs: z.object({ queued: count, applied: count, skipped: count }),
  bySource: z.array(sourceSchema),
  otherSources: sourceSchema.omit({ source: true }).nullable(),
  /** Applications made in the range, by the furthest stage they reached. */
  stages: z.object(stages),
  byAts: z.array(groupSchema),
  byRole: z.array(groupSchema),
  byMatch: z.array(groupSchema),
  timeToApply: z.object({
    count,
    medianHours: z.number().nullable(),
    buckets: z.array(z.object({ key: z.string(), count })),
  }),
  autofill: autofillSchema.extend({
    forms: count,
    bySource: z.array(autofillSchema.extend({ source: z.string() })),
  }),
})

export type StatsOverview = z.infer<typeof statsOverviewSchema>
export type StatsGroup = z.infer<typeof groupSchema>
