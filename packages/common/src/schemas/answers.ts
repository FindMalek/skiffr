import { z } from "zod"
import { ANSWER_SOURCES, ANSWER_STATUSES, ANSWER_VALUE_MAX, LABEL_MAX } from "../constants"
import { CLEAN_MESSAGE, clean } from "./text"

export const answerSourceSchema = z.enum(ANSWER_SOURCES)

export const answerStatusSchema = z.enum(ANSWER_STATUSES)

export const answerSchema = z.object({
  id: z.string(),
  normalizedLabel: z.string(),
  rawLabel: z.string(),
  value: z.string(),
  source: answerSourceSchema,
  timesUsed: z.number(),
  timesCorrected: z.number(),
  status: answerStatusSchema,
  lastCorrectedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const answerInputSchema = z.object({
  rawLabel: z.string().trim().min(1).max(LABEL_MAX).refine(clean, CLEAN_MESSAGE),
  value: z.string().max(ANSWER_VALUE_MAX).refine(clean, CLEAN_MESSAGE),
  source: answerSourceSchema.default("manual"),
})

export const answerUpdateSchema = z.object({
  id: z.uuid(),
  value: z.string().max(ANSWER_VALUE_MAX).refine(clean, CLEAN_MESSAGE).optional(),
  source: answerSourceSchema.optional(),
})

/** Reported by the extension after it filled a field: `corrected` when the user changed the filled value. */
export const answerUsageSchema = z.object({ id: z.uuid(), corrected: z.boolean().default(false) })

export const ANSWER_ORIGINS = ["learned", "confirmed", "manual", "imported", "ai"] as const

const count = z.number().int().nonnegative()

/**
 * Where one answer came from and how it is doing, from the fields recorded after fills (the last 90 days, see
 * `FIELD_EVENT_RETENTION_DAYS`). Counts, sites and times only: never a filled or final value. `forms`, `sites` and
 * `firstSeen*` count recorded fields with this question whatever filled them (profile, answer bank, model or site
 * profile): only `lastUsedAt` is limited to fills from the answer bank. `site` is a host, or a host and its first path
 * segment on shared ATS hosts, as the extension recorded it.
 */
export const answerProvenanceSchema = z.object({
  id: z.string(),
  /** Where it came from, not its status: `learned` from a correction (also when it was rejected since, read `status` in the list), `confirmed` by the user, `manual` typed in, `imported`, or drafted by `ai`. */
  origin: z.enum(ANSWER_ORIGINS),
  /** Recorded forms with this question, over all sites and whatever filled them. */
  forms: count,
  siteCount: count,
  /** Up to three sites, most forms first. */
  sites: z.array(z.object({ site: z.string(), forms: count })),
  firstSeenAt: z.date().nullable(),
  firstSeenSite: z.string().nullable(),
  /** The last time a field with this question was filled from the answer bank. */
  lastUsedAt: z.date().nullable(),
  timesUsed: count,
  timesCorrected: count,
  timesCleared: count,
  /** The user corrected a field with this question to something other than the answer's current value: how many different values, where and when last. Null when they never did. */
  conflict: z.object({ values: count, sites: z.array(z.string()), lastAt: z.date() }).nullable(),
})

export type Answer = z.infer<typeof answerSchema>
export type AnswerProvenance = z.infer<typeof answerProvenanceSchema>
export type AnswerOrigin = AnswerProvenance["origin"]
