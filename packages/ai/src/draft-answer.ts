import { AI_ANSWER_LENGTH_DEFAULT } from "@skiffr/common/constants"
import type { Correction, DraftAnswerResult } from "@skiffr/common/schemas"
import { generateText, type LanguageModel } from "ai"
import { type AiProfile, dataBlock, flattenProfile, UNTRUSTED_NOTICE } from "./data"
import { toAiError } from "./errors"

const TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = 3_000
const NO_ANSWER = "NO_ANSWER"

const SYSTEM = `You draft answers to open-ended job application questions for the applicant, in first person.
- Plain, human tone: short sentences, no buzzwords, no flattery, no bullet lists unless asked.
- Use only facts found in the profile block or in the corrections. Never invent employers, job titles, dates, degrees, skills, numbers or projects. If the profile does not back a claim, leave it out.
- If the profile holds too little to answer honestly, reply with exactly ${NO_ANSWER} and nothing else.
- Corrections are earlier answers the applicant wrote or fixed. Match their voice and reuse their facts.
- Reply with the answer text only, under the character limit given in the request.
${UNTRUSTED_NOTICE}`

/** Contact details and pay never help an open answer, so they are not sent: identity is name and pronouns only, salary is out, and extra fields that look like contact or pay are dropped. */
const SENSITIVE_FIELD = /e ?mail|phone|mobile|salary|compensation|password|ssn|iban|passport/
const ALLOWED = (key: string) => {
  if (key.startsWith("identity.")) return ["firstName", "lastName", "pronouns"].some((k) => key === `identity.${k}`)
  if (key.startsWith("salary")) return false
  if (key.startsWith("fields.")) return !SENSITIVE_FIELD.test(key)
  return true
}

function prefix(text: string, max: number, granularity: "sentence" | "word" | "grapheme"): string {
  let out = ""
  for (const { segment } of new Intl.Segmenter(undefined, { granularity }).segment(text)) {
    if (out.length + segment.length > max) break
    out += segment
  }
  return out
}

/** Cuts at a sentence end, else a word end, else a grapheme, so the answer never runs past the limit or splits a character. */
export function fitLength(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  const sentences = prefix(trimmed, max, "sentence").trim()
  if (sentences.length > max / 2) return sentences
  const words = prefix(trimmed, max, "word").replace(/[\s,;:、，；：]+$/u, "")
  return words || prefix(trimmed, max, "grapheme")
}

export async function draftAnswer(input: {
  model: LanguageModel
  question: string
  jobDescription?: string
  profile: AiProfile
  corrections?: Correction[]
  maxLength?: number
}): Promise<DraftAnswerResult> {
  const maxLength = input.maxLength ?? AI_ANSWER_LENGTH_DEFAULT
  const profile = Object.entries(flattenProfile(input.profile, ALLOWED))
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")
  const corrections = (input.corrections ?? []).map((c) => `Question: ${c.question}\nAnswer: ${c.answer}`).join("\n\n")

  let text: string
  try {
    ;({ text } = await generateText({
      model: input.model,
      system: SYSTEM,
      temperature: 0.4,
      maxRetries: 1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      prompt: [
        `Character limit: ${maxLength}`,
        dataBlock("profile", profile),
        ...(corrections ? [dataBlock("corrections", corrections)] : []),
        ...(input.jobDescription ? [dataBlock("job_description", input.jobDescription)] : []),
        dataBlock("question", input.question),
      ].join("\n\n"),
    }))
  } catch (error) {
    throw toAiError(error, input.model)
  }

  const fitted = fitLength(text, maxLength)
  if (!fitted) return { ok: false, reason: "empty" }
  if (new RegExp(`^${NO_ANSWER}\\b`).test(fitted)) return { ok: false, reason: "not_enough_info" }
  return { ok: true, text: fitted }
}
