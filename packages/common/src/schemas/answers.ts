import { z } from "zod"
import { ANSWER_SOURCES, ANSWER_STATUSES, ANSWER_VALUE_MAX, LABEL_MAX } from "../constants"

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
  rawLabel: z.string().trim().min(1).max(LABEL_MAX),
  value: z.string().max(ANSWER_VALUE_MAX),
  source: answerSourceSchema.default("manual"),
})

export const answerUpdateSchema = z.object({
  id: z.uuid(),
  value: z.string().max(ANSWER_VALUE_MAX).optional(),
  source: answerSourceSchema.optional(),
})

/** Reported by the extension after it filled a field: `corrected` when the user changed the filled value. */
export const answerUsageSchema = z.object({ id: z.uuid(), corrected: z.boolean().default(false) })

export type Answer = z.infer<typeof answerSchema>
