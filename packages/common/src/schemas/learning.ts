import { z } from "zod"
import {
  AI_OPTION_TEXT_MAX,
  AI_OPTIONS_MAX,
  FIELD_EVENT_SOURCES,
  LABEL_MAX,
  LEARNING_FIELDS_MAX,
  LEARNING_REQUEST_CHARS_MAX,
  LEARNING_VALUE_MAX,
  SITE_KEY_MAX,
  STATS_APPLICATIONS_MAX,
} from "../constants"
import { answerSchema } from "./answers"

/** The host the form lives on, plus the first path segment on multi-tenant ATS hosts (`boards.greenhouse.io/acme`). */
export const siteKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(SITE_KEY_MAX)
  .regex(/^[a-z0-9.:-]+(\/[a-z0-9._~%-]+)?$/, "Use the host, optionally with the first path segment.")

const label = z.string().trim().min(1).max(LABEL_MAX)
const fieldType = z.string().trim().max(40).optional()
const options = z.array(z.string().trim().max(AI_OPTION_TEXT_MAX)).max(AI_OPTIONS_MAX).default([])

export const learningFieldSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label,
  type: fieldType,
  options,
})

const chars = (texts: (string | undefined)[]) => texts.reduce<number>((sum, text) => sum + (text?.length ?? 0), 0)

export const lookupInputSchema = z
  .object({ siteKey: siteKeySchema, fields: z.array(learningFieldSchema).min(1).max(LEARNING_FIELDS_MAX) })
  .refine(({ fields }) => new Set(fields.map((f) => f.id)).size === fields.length, {
    message: "Field ids must be unique.",
    path: ["fields"],
  })
  .refine(
    ({ fields }) =>
      fields.reduce((sum, f) => sum + chars([f.id, f.label, f.type, ...f.options]), 0) <= LEARNING_REQUEST_CHARS_MAX,
    { message: `The fields add up to more than ${LEARNING_REQUEST_CHARS_MAX} characters.`, path: ["fields"] },
  )

const lookupMatchSchema = z.object({
  fieldId: z.string(),
  answerId: z.string(),
  value: z.string(),
  source: z.enum(["exact", "label", "similar"]),
  score: z.number(),
  timesUsed: z.number(),
  timesCorrected: z.number(),
})

export const lookupOutputSchema = z.object({
  matches: z.array(z.union([lookupMatchSchema, z.object({ fieldId: z.string(), source: z.literal("none") })])),
})

export const fieldEventInputSchema = z.object({
  label,
  type: fieldType,
  options,
  filledValue: z.string().max(LEARNING_VALUE_MAX),
  finalValue: z.string().max(LEARNING_VALUE_MAX),
  source: z.enum(FIELD_EVENT_SOURCES),
})

export const recordInputSchema = z
  .object({
    siteKey: siteKeySchema,
    applicationId: z.uuid().optional(),
    events: z.array(fieldEventInputSchema).min(1).max(LEARNING_FIELDS_MAX),
  })
  .refine(
    ({ events }) =>
      events.reduce((sum, e) => sum + chars([e.label, e.type, e.filledValue, e.finalValue, ...e.options]), 0) <=
      LEARNING_REQUEST_CHARS_MAX,
    { message: `The events add up to more than ${LEARNING_REQUEST_CHARS_MAX} characters.`, path: ["events"] },
  )

export const recordOutputSchema = z.object({ recorded: z.number(), skipped: z.number() })

export const suggestionSchema = z.object({
  kind: z.enum(["keep", "flip_flop", "stale"]),
  answer: answerSchema,
  /** Corrections that led to this suggestion: identical ones for keep, distinct final values for flip_flop. */
  count: z.number(),
})

export const suggestionsOutputSchema = z.array(suggestionSchema)

export const resolveSuggestionInputSchema = z.object({
  answerId: z.uuid(),
  decision: z.enum(["keep", "reject"]),
})

export const statsInputSchema = z.object({
  limit: z.number().int().min(1).max(STATS_APPLICATIONS_MAX).default(50),
})

export const statsOutputSchema = z.object({
  applications: z.array(
    z.object({
      applicationId: z.string(),
      appliedAt: z.date(),
      fields: z.number(),
      corrections: z.number(),
    }),
  ),
})

export type LearningField = z.infer<typeof learningFieldSchema>
export type FieldEventInput = z.infer<typeof fieldEventInputSchema>
