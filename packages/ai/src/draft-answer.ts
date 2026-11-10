import { AI_ANSWER_LENGTH_DEFAULT } from "@skiffr/common/constants"
import type { Correction, DraftAnswerResult } from "@skiffr/common/schemas"
import { generateText, type LanguageModel } from "ai"
import { type AiProfile, assertPromptSize, dataBlock, fitLines, flattenProfile, UNTRUSTED_NOTICE } from "./data"
import { toAiError } from "./errors"
import { isShared } from "./shared-keys"

const TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = 3_000
const NO_ANSWER = "NO_ANSWER"
const VALUE_MAX = 300
const PROFILE_BLOCK_MAX = 6_000

const SYSTEM = `You draft answers to open-ended job application questions for the applicant, in first person.
- Plain, human tone: short sentences, no buzzwords, no flattery, no bullet lists unless asked.
- Use only facts found in the profile block or in the corrections. Never invent employers, job titles, dates, degrees, skills, numbers or projects. If the profile does not back a claim, leave it out.
- If the profile holds too little to answer honestly, reply with exactly ${NO_ANSWER} and nothing else.
- Corrections are earlier answers the applicant wrote or fixed. Match their voice and reuse their facts.
- Reply with the answer text only, under the character limit given in the request.
${UNTRUSTED_NOTICE}`

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
  const profile = fitLines(
    Object.entries(flattenProfile(input.profile, isShared)).map(
      ([key, value]) => `${key}: ${value.slice(0, VALUE_MAX)}`,
    ),
    PROFILE_BLOCK_MAX,
  ).join("\n")
  const corrections = (input.corrections ?? []).map((c) => `Question: ${c.question}\nAnswer: ${c.answer}`).join("\n\n")

  const prompt = [
    `Character limit: ${maxLength}`,
    dataBlock("profile", profile),
    ...(corrections ? [dataBlock("corrections", corrections)] : []),
    ...(input.jobDescription ? [dataBlock("job_description", input.jobDescription)] : []),
    dataBlock("question", input.question),
  ].join("\n\n")
  assertPromptSize(SYSTEM, prompt)

  let text: string
  try {
    ;({ text } = await generateText({
      model: input.model,
      system: SYSTEM,
      temperature: 0.4,
      maxRetries: 1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      prompt,
    }))
  } catch (error) {
    throw toAiError(error, input.model)
  }

  const fitted = fitLength(text, maxLength)
  if (!fitted) return { ok: false, reason: "empty" }
  if (new RegExp(`^${NO_ANSWER}\\b`).test(fitted)) return { ok: false, reason: "not_enough_info" }
  return { ok: true, text: fitted }
}
