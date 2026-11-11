import { z } from "zod"
import {
  AI_OPTION_TEXT_MAX,
  AI_OPTIONS_MAX,
  FIELD_EVENT_SOURCES,
  LABEL_MAX,
  LEARNING_FIELDS_MAX,
  LEARNING_REQUEST_CHARS_MAX,
  LEARNING_VALUE_MAX,
  SITE_FIELD_SOURCES,
  SITE_KEY_MAX,
  STATS_APPLICATIONS_MAX,
} from "../constants"
import { answerSchema } from "./answers"
import { CLEAN_MESSAGE, clean } from "./text"

/** The host the form lives on, plus the first path segment on multi-tenant ATS hosts (`boards.greenhouse.io/acme`). */
export const siteKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(SITE_KEY_MAX)
  .regex(/^[a-z0-9.:-]+(\/[a-z0-9._~%-]+)?$/, "Use the host, optionally with the first path segment.")

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
  /** The saved answer behind the match: absent for a site entry the user typed on that site. */
  answerId: z.string().optional(),
  value: z.string(),
  /** `site` is what happened last time on this very form: it beats the answer bank for the field. */
  source: z.enum(["site", "exact", "label", "similar"]),
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

/**
 * What happened to the batch's site profile. The extension must send an event for every learnable field of the form,
 * the empty ones too (`filledValue` and `finalValue` both empty): a batch of only some of them is `partial_form` and not
 * saved, and one with nothing learnable is `no_learnable_fields`.
 */
export const siteProfileStatusSchema = z.object({
  status: z.enum(["saved", "skipped"]),
  reason: z.enum(["partial_form", "no_learnable_fields"]).optional(),
})

export const recordOutputSchema = z.object({
  recorded: z.number(),
  skipped: z.number(),
  siteProfile: siteProfileStatusSchema,
})

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
  limit: z.coerce.number().int().min(1).max(STATS_APPLICATIONS_MAX).default(50),
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

export const siteFieldSourceSchema = z.enum(SITE_FIELD_SOURCES)

/** What one field of a saved form was last time, keyed by the field's key (normalized label and control type) in `site_profile.field_map`. */
export const siteFieldEntrySchema = z.object({
  label: z.string(),
  value: z.string(),
  kind: z.string(),
  source: siteFieldSourceSchema,
  answerId: z.string().optional(),
  /** When the value was last taken from its source (ISO): a profile edited after that makes the entry stale. */
  savedAt: z.string(),
  timesUsed: z.number(),
  timesCorrected: z.number(),
  /** Clears in a row: any accept or correction resets it, three stop the autofill. */
  timesCleared: z.number(),
})

export const siteProfileSchema = z.object({
  id: z.string(),
  siteKey: z.string(),
  timesUsed: z.number(),
  lastUsedAt: z.date(),
  fields: z.array(siteFieldEntrySchema.extend({ fieldKey: z.string() })),
})

export const siteProfilesInputSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
export const siteProfilesOutputSchema = z.array(siteProfileSchema)
/** Forgets the learned form maps of one site and nothing else: saved answers, the profile and logged corrections stay. */
export const forgetSiteInputSchema = z.object({ siteKey: siteKeySchema })
export const forgetSiteOutputSchema = z.object({ removedForms: z.number() })

export type SiteFieldEntry = z.infer<typeof siteFieldEntrySchema>
export type SiteFieldMap = Record<string, SiteFieldEntry>
