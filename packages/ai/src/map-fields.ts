import { AI_GENERATED_VALUE_MAX, AI_REASON_MAX } from "@skiffr/common/constants"
import type {
  FieldDescriptor,
  ModelMapping,
  SensitiveCategory,
  SensitiveVerdict as Verdict,
} from "@skiffr/common/schemas"
import { sensitiveCategorySchema } from "@skiffr/common/schemas"
import { generateText, type LanguageModel, Output } from "ai"
import { z } from "zod"
import { type AiProfile, assertPromptSize, dataBlock, fitLines, flattenProfile, UNTRUSTED_NOTICE } from "./data"
import { toAiError } from "./errors"
import { isSensitiveQuestion } from "./learnable-extended"
import { SENSITIVE_POLICY } from "./sensitive"
import { isShared } from "./shared-keys"

const VALUE_PREVIEW_MAX = 60
const KEYS_MAX = 150
const KEY_LENGTH_MAX = 100
const PROFILE_BLOCK_MAX = 8_000
const TIMEOUT_MS = 20_000
const MAX_OUTPUT_TOKENS = 8_000
const NEVER_FILLED = new Set(["password", "hidden", "file"])

/** Case, spaces and zero-width characters in `type` can't dodge the check. */
const blocked = (field: FieldDescriptor) =>
  NEVER_FILLED.has(
    (field.type ?? "")
      .normalize("NFKC")
      .replace(/[^\p{L}]/gu, "")
      .toLowerCase(),
  )

/** Keys are always offered (they are what gets copied), values only for shared keys and when short. At most KEYS_MAX keys, shared ones first then the rest in a fixed order, and only the ones that fit. */
function profileKeyLines(profile: AiProfile): { lines: string[]; keys: Set<string> } {
  const all = Object.entries(flattenProfile(profile)).filter(([key]) => key.length <= KEY_LENGTH_MAX)
  const entries = [...all.filter(([key]) => isShared(key)), ...all.filter(([key]) => !isShared(key))]
  const lines = fitLines(
    entries
      .slice(0, KEYS_MAX)
      .map(([key, value]) => (isShared(key) && value.length <= VALUE_PREVIEW_MAX ? `${key}: ${value}` : key)),
    PROFILE_BLOCK_MAX,
  )
  return { lines, keys: new Set(entries.slice(0, lines.length).map(([key]) => key)) }
}

/**
 * Loose on purpose: the model's answer is checked in code, so a bad key downgrades one field instead of failing the call.
 * `sensitive` is nullable so that a null verdict can be told apart and treated as sensitive. `category` is any string here and
 * read as one of the known categories in code, so a made-up category costs one field its label, not the whole batch.
 */
const modelOutputSchema = z.object({
  mappings: z.array(
    z.object({
      id: z.string(),
      sensitive: z.boolean().nullable(),
      category: z.string().nullable(),
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
For every field id first decide "sensitive" (true or false) and a "category" by this policy, then one action. A sensitive field is always "skip".
POLICY:
${SENSITIVE_POLICY}

Actions:
- "profile": copy the value stored under one profile key. Set "key" to a key from the PROFILE_KEYS list, exactly as written.
- "generate": only for a short neutral value no profile key holds (for example a yes/no or an option pick). Set "value". Never invent employers, titles, dates, degrees, skills, contact details or credentials.
- "skip": the field is unclear, sensitive, or nothing fits. Passwords, tokens and secrets are always "skip".
Give "confidence" from 0 to 1 and a one line "reason". Return exactly one entry per field id, using only ids from FIELDS. Set unused "key" and "value" to null.
${UNTRUSTED_NOTICE}`

const open: Verdict = { sensitive: false, category: null }
const withheld = (category: SensitiveCategory | null): Verdict => ({ sensitive: true, category })

const skip = (id: string, reason: string, verdict: Verdict = open): ModelMapping => ({
  id,
  action: "skip",
  confidence: 0,
  reason,
  ...verdict,
})

/** The question as a person reads it: the label and the other texts the page gave the control. */
function guarded(field: FieldDescriptor): boolean {
  const texts = [field.label, field.ariaLabel, field.placeholder, field.name].filter(
    (text): text is string => !!text?.trim(),
  )
  const [label, ...rest] = texts
  return (
    isSensitiveQuestion({ label, options: field.options }) || rest.some((text) => isSensitiveQuestion({ label: text }))
  )
}

function describe(field: FieldDescriptor): string {
  const { id, options, ...rest } = field
  return JSON.stringify({ id, ...rest, ...(options.length > 0 ? { options } : {}) })
}

const categoryOf = (raw: RawMapping): SensitiveCategory =>
  sensitiveCategorySchema.safeParse(raw.category).data ?? "other"

/** A verdict that is not an explicit `false` counts as sensitive. */
function verdictOf(raw: RawMapping): Verdict {
  return raw.sensitive === false ? open : withheld(categoryOf(raw))
}

function normalize(raw: RawMapping, keys: Set<string>): ModelMapping {
  const verdict = verdictOf(raw)
  if (verdict.sensitive) return skip(raw.id, "sensitive question", verdict)
  const confidence = Math.min(1, Math.max(0, Number.isFinite(raw.confidence) ? raw.confidence : 0))
  const reason = raw.reason.slice(0, AI_REASON_MAX)

  if (raw.action === "profile") {
    if (!raw.key || !keys.has(raw.key)) return skip(raw.id, "model picked a key the profile does not have")
    return { id: raw.id, action: "profile", key: raw.key, confidence, reason, ...verdict }
  }
  if (raw.action === "generate") {
    const value = raw.value?.trim()
    if (!value) return skip(raw.id, "model gave no value")
    return {
      id: raw.id,
      action: "generate",
      value: value.slice(0, AI_GENERATED_VALUE_MAX),
      confidence,
      reason,
      ...verdict,
    }
  }
  return { id: raw.id, action: "skip", confidence, reason, ...verdict }
}

export type MapFieldsResult = {
  /** One per input field, in input order. */
  mappings: ModelMapping[]
  /** Fields the model itself called sensitive, with its category: the only verdicts worth remembering. */
  flagged: Map<string, SensitiveCategory>
}

/**
 * One mapping per input field, in input order. A field is withheld, and never sent to the model, when it is a password,
 * hidden or file input, when the guard's word lists know the question, or when `known` already holds a verdict for it.
 * For the rest the model gives a `sensitive` verdict next to its mapping: anything but an explicit `false`, and a field it
 * left out, is withheld. Unknown ids are dropped and a profile key that doesn't exist is downgraded to skip.
 */
export async function mapFields(input: {
  model: LanguageModel
  fields: FieldDescriptor[]
  profile: AiProfile
  /** Verdicts remembered from earlier calls, by field id. */
  known?: ReadonlyMap<string, SensitiveCategory>
}): Promise<MapFieldsResult> {
  const known = input.known ?? new Map<string, SensitiveCategory>()
  const secret = (field: FieldDescriptor) => blocked(field)
  const withheldCategory = (field: FieldDescriptor): SensitiveCategory | null =>
    secret(field) ? "secret" : (known.get(field.id) ?? (guarded(field) ? "other" : null))
  const fillable = input.fields.filter((field) => withheldCategory(field) === null)
  const raw = new Map<string, RawMapping>()
  const { lines, keys } = profileKeyLines(input.profile)

  if (fillable.length > 0) {
    const prompt = [
      "PROFILE_KEYS (key, with a value preview where it is short and safe to share):",
      dataBlock("profile", lines.join("\n")),
      "FIELDS (one JSON object per line):",
      dataBlock("fields", fillable.map(describe).join("\n")),
    ].join("\n")
    assertPromptSize(SYSTEM, prompt)
    try {
      const { output } = await generateText({
        model: input.model,
        system: SYSTEM,
        temperature: 0,
        maxRetries: 1,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        output: Output.object({ schema: modelOutputSchema }),
        prompt,
      })
      for (const mapping of output.mappings) {
        // two entries for one id: the field is sensitive if either says so
        const prior = raw.get(mapping.id)
        if (!prior || (prior.sensitive === false && mapping.sensitive !== false)) raw.set(mapping.id, mapping)
      }
    } catch (error) {
      throw toAiError(error, input.model)
    }
  }

  const flagged = new Map<string, SensitiveCategory>()
  const mappings = input.fields.map((field): ModelMapping => {
    const category = withheldCategory(field)
    if (category) return skip(field.id, "sensitive question", withheld(category))
    const mapping = raw.get(field.id)
    if (!mapping) return skip(field.id, "model gave no answer", withheld("other"))
    if (mapping.sensitive === true) flagged.set(field.id, categoryOf(mapping))
    return normalize(mapping, keys)
  })
  return { mappings, flagged }
}
