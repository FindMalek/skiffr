import { AI_GENERATED_VALUE_MAX, AI_REASON_MAX } from "@skiffr/common/constants"
import type { FieldDescriptor, FieldMapping } from "@skiffr/common/schemas"
import { generateText, type LanguageModel, Output } from "ai"
import { z } from "zod"
import { type AiProfile, dataBlock, flattenProfile, UNTRUSTED_NOTICE } from "./data"
import { toAiError } from "./errors"

const VALUE_PREVIEW_MAX = 100
const TIMEOUT_MS = 20_000
const MAX_OUTPUT_TOKENS = 8_000
const NEVER_FILLED = new Set(["password", "hidden", "file"])

/** Loose on purpose: the model's answer is checked in code, so a bad key downgrades one field instead of failing the call. */
const modelOutputSchema = z.object({
  mappings: z.array(
    z.object({
      id: z.string(),
      action: z.enum(["profile", "generate", "skip"]),
      key: z.string().nullable(),
      value: z.string().nullable(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
})

type RawMapping = z.infer<typeof modelOutputSchema>["mappings"][number]

const SYSTEM = `You map job application form fields to an applicant's profile.
For every field id decide one action:
- "profile": copy the value stored under one profile key. Set "key" to a key from the PROFILE_KEYS list, exactly as written.
- "generate": only for a short neutral value no profile key holds (for example a yes/no or an option pick). Set "value". Never invent employers, titles, dates, degrees, skills, contact details or credentials.
- "skip": the field is unclear, sensitive, or nothing fits. Passwords, tokens and secrets are always "skip".
Give "confidence" from 0 to 1 and a one line "reason". Return exactly one entry per field id, using only ids from FIELDS. Set unused "key" and "value" to null.
${UNTRUSTED_NOTICE}`

const skip = (id: string, reason: string): FieldMapping => ({ id, action: "skip", confidence: 0, reason })

function describe(field: FieldDescriptor): string {
  const { id, options, ...rest } = field
  return JSON.stringify({ id, ...rest, ...(options.length > 0 ? { options } : {}) })
}

function normalize(raw: RawMapping, keys: Set<string>): FieldMapping {
  const confidence = Math.min(1, Math.max(0, Number.isFinite(raw.confidence) ? raw.confidence : 0))
  const reason = raw.reason.slice(0, AI_REASON_MAX)

  if (raw.action === "profile") {
    if (!raw.key || !keys.has(raw.key)) return skip(raw.id, "model picked a key the profile does not have")
    return { id: raw.id, action: "profile", key: raw.key, confidence, reason }
  }
  if (raw.action === "generate") {
    const value = raw.value?.trim()
    if (!value) return skip(raw.id, "model gave no value")
    return { id: raw.id, action: "generate", value: value.slice(0, AI_GENERATED_VALUE_MAX), confidence, reason }
  }
  return { id: raw.id, action: "skip", confidence, reason }
}

/**
 * One mapping per input field, in input order. Password, hidden and file inputs are skipped in code and never sent to the
 * model. Unknown ids are dropped, missing ones are skipped, and a profile key that doesn't exist is downgraded to skip.
 */
export async function mapFields(input: {
  model: LanguageModel
  fields: FieldDescriptor[]
  profile: AiProfile
}): Promise<FieldMapping[]> {
  const fillable = input.fields.filter((field) => !NEVER_FILLED.has(field.type?.toLowerCase() ?? ""))
  const raw = new Map<string, RawMapping>()

  if (fillable.length > 0) {
    const flat = flattenProfile(input.profile)
    const keyList = Object.entries(flat)
      .map(([key, value]) => `${key}: ${value.slice(0, VALUE_PREVIEW_MAX)}`)
      .join("\n")
    try {
      const { output } = await generateText({
        model: input.model,
        system: SYSTEM,
        temperature: 0,
        maxRetries: 1,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        output: Output.object({ schema: modelOutputSchema }),
        prompt: [
          "PROFILE_KEYS (key: value preview):",
          dataBlock("profile", keyList),
          "FIELDS (one JSON object per line):",
          dataBlock("fields", fillable.map(describe).join("\n")),
        ].join("\n"),
      })
      for (const mapping of output.mappings) raw.set(mapping.id, mapping)
    } catch (error) {
      throw toAiError(error, input.model)
    }
  }

  const keys = new Set(Object.keys(flattenProfile(input.profile)))
  return input.fields.map((field) => {
    if (NEVER_FILLED.has(field.type?.toLowerCase() ?? "")) return skip(field.id, "this field type is never filled")
    const mapping = raw.get(field.id)
    return mapping ? normalize(mapping, keys) : skip(field.id, "model gave no answer")
  })
}
