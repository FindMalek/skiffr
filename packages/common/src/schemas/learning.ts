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

/** Page-controlled text: no NUL or other control characters (tab, newline and return are fine) and no lone surrogates, which postgres would reject. */
const hasControl = (text: string) =>
  [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
  })
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
const clean = (text: string) => !hasControl(text) && !LONE_SURROGATE.test(text)
const CLEAN_MESSAGE = "Control characters are not allowed."
const text = (max: number) => z.string().max(max).refine(clean, CLEAN_MESSAGE)
const trimmed = (max: number) => z.string().trim().max(max).refine(clean, CLEAN_MESSAGE)

const label = z.string().trim().min(1).max(LABEL_MAX).refine(clean, CLEAN_MESSAGE)
const fieldType = trimmed(40).optional()
/** The control's `autocomplete` token(s): browsers say what a field holds, in any language. */
const autocomplete = trimmed(100).optional()
const options = z.array(trimmed(AI_OPTION_TEXT_MAX)).max(AI_OPTIONS_MAX).default([])

export const learningFieldSchema = z.object({
  id: z.string().trim().min(1).max(100).refine(clean, CLEAN_MESSAGE),
  label,
  type: fieldType,
  autocomplete,
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
      fields.reduce((sum, f) => sum + chars([f.id, f.label, f.type, f.autocomplete, ...f.options]), 0) <=
      LEARNING_REQUEST_CHARS_MAX,
    { message: `The fields add up to more than ${LEARNING_REQUEST_CHARS_MAX} characters.`, path: ["fields"] },
  )

const lookupMatchSchema = z.object({
  fieldId: z.string(),
  answerId: z.string(),
  value: z.string(),
  source: z.enum(["exact", "label", "similar"]),
  /** False for a suggestion the extension must not fill by itself. */
  autofill: z.boolean(),
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
  autocomplete,
  options,
  filledValue: text(LEARNING_VALUE_MAX),
  finalValue: text(LEARNING_VALUE_MAX),
  source: z.enum(FIELD_EVENT_SOURCES),
})

export const recordInputSchema = z
  .object({
    siteKey: siteKeySchema,
    applicationId: z.uuid().optional(),
    /** Sent once per batch and reused on a retry, so a retry changes nothing. */
    batchId: z.uuid().optional(),
    events: z.array(fieldEventInputSchema).min(1).max(LEARNING_FIELDS_MAX),
  })
  .refine(
    ({ events }) =>
      events.reduce(
        (sum, e) => sum + chars([e.label, e.type, e.autocomplete, e.filledValue, e.finalValue, ...e.options]),
        0,
      ) <= LEARNING_REQUEST_CHARS_MAX,
    { message: `The events add up to more than ${LEARNING_REQUEST_CHARS_MAX} characters.`, path: ["events"] },
  )

export const recordOutputSchema = z.object({ recorded: z.number(), skipped: z.number() })

export const suggestionSchema = z.object({
  kind: z.enum(["keep", "flip_flop", "cleared", "stale"]),
  answer: answerSchema,
  /** Corrections behind keep and flip_flop, clears in a row behind cleared, 0 for stale. */
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
      correctionsPerField: z.number(),
    }),
  ),
})

export type LearningField = z.infer<typeof learningFieldSchema>
export type FieldEventInput = z.infer<typeof fieldEventInputSchema>
