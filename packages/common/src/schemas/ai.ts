import { z } from "zod"
import {
  AI_ANSWER_LENGTH_DEFAULT,
  AI_ANSWER_LENGTH_MAX,
  AI_ANSWER_LENGTH_MIN,
  AI_CORRECTION_TEXT_MAX,
  AI_CORRECTIONS_MAX,
  AI_FIELD_TEXT_MAX,
  AI_FIELDS_MAX,
  AI_GENERATED_VALUE_MAX,
  AI_JOB_DESCRIPTION_MAX,
  AI_OPTION_TEXT_MAX,
  AI_OPTIONS_MAX,
  AI_QUESTION_MAX,
  AI_REASON_MAX,
  AI_REQUEST_CHARS_MAX,
} from "../constants"

const fieldText = z.string().trim().max(AI_FIELD_TEXT_MAX).optional()

/** What the extension reads off a form control. Everything but the id is untrusted page text. */
export const fieldDescriptorSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: fieldText,
  name: fieldText,
  ariaLabel: fieldText,
  placeholder: fieldText,
  type: z.string().trim().max(40).optional(),
  options: z.array(z.string().trim().max(AI_OPTION_TEXT_MAX)).max(AI_OPTIONS_MAX).default([]),
})

export const correctionSchema = z.object({
  question: z.string().trim().max(AI_QUESTION_MAX),
  answer: z.string().trim().max(AI_CORRECTION_TEXT_MAX),
})

const fieldChars = (field: z.infer<typeof fieldDescriptorSchema>) =>
  [field.id, field.label, field.name, field.ariaLabel, field.placeholder, field.type, ...field.options].reduce<number>(
    (sum, text) => sum + (text?.length ?? 0),
    0,
  )

export const mapFieldsInputSchema = z
  .object({ fields: z.array(fieldDescriptorSchema).min(1).max(AI_FIELDS_MAX) })
  .refine(({ fields }) => new Set(fields.map((f) => f.id)).size === fields.length, {
    message: "Field ids must be unique.",
    path: ["fields"],
  })
  .refine(({ fields }) => fields.reduce((sum, f) => sum + fieldChars(f), 0) <= AI_REQUEST_CHARS_MAX, {
    message: `The fields add up to more than ${AI_REQUEST_CHARS_MAX} characters.`,
    path: ["fields"],
  })

export const draftAnswerInputSchema = z.object({
  question: z.string().trim().min(1).max(AI_QUESTION_MAX),
  jobDescription: z.string().trim().max(AI_JOB_DESCRIPTION_MAX).optional(),
  corrections: z.array(correctionSchema).max(AI_CORRECTIONS_MAX).default([]),
  maxLength: z.number().int().min(AI_ANSWER_LENGTH_MIN).max(AI_ANSWER_LENGTH_MAX).default(AI_ANSWER_LENGTH_DEFAULT),
})

const confidence = z.number().min(0).max(1)
const reason = z.string().max(AI_REASON_MAX)

/** One decision per field: copy a profile value, fill a short generated one, or leave it alone. */
export const fieldMappingSchema = z.discriminatedUnion("action", [
  z.object({ id: z.string(), action: z.literal("profile"), key: z.string(), confidence, reason }),
  z.object({
    id: z.string(),
    action: z.literal("generate"),
    value: z.string().max(AI_GENERATED_VALUE_MAX),
    confidence,
    reason,
  }),
  z.object({ id: z.string(), action: z.literal("skip"), confidence, reason }),
])

export const mapFieldsOutputSchema = z.object({ mappings: z.array(fieldMappingSchema) })
export const draftAnswerOutputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), text: z.string() }),
  z.object({ ok: z.literal(false), reason: z.enum(["empty", "not_enough_info"]) }),
])

export type FieldDescriptor = z.infer<typeof fieldDescriptorSchema>
export type Correction = z.infer<typeof correctionSchema>
export type FieldMapping = z.infer<typeof fieldMappingSchema>
export type DraftAnswerResult = z.infer<typeof draftAnswerOutputSchema>
