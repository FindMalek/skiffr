import { AI_ANSWER_LENGTH_DEFAULT } from "@skiffr/common/constants"
import type { Correction } from "@skiffr/common/schemas"
import { generateText, type LanguageModel } from "ai"
import { type AiProfile, dataBlock, flattenProfile, UNTRUSTED_NOTICE } from "./data"

const SYSTEM = `You draft answers to open-ended job application questions for the applicant, in first person.
- Plain, human tone: short sentences, no buzzwords, no flattery, no bullet lists unless asked.
- Use only facts found in the profile block or in the corrections. Never invent employers, job titles, dates, degrees, skills, numbers or projects. If the profile does not back a claim, leave it out; if it holds too little to answer, say so briefly in one honest sentence.
- Corrections are earlier answers the applicant wrote or fixed. Match their voice and reuse their facts.
- Reply with the answer text only, under the character limit given in the request.
${UNTRUSTED_NOTICE}`

/** Cuts at a sentence end, else a word end, so the answer never runs past the limit. */
export function fitLength(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  const head = trimmed.slice(0, max)
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "))
  if (sentenceEnd > max / 2) return head.slice(0, sentenceEnd + 1)
  const wordEnd = head.lastIndexOf(" ")
  return (wordEnd > 0 ? head.slice(0, wordEnd) : head).replace(/[,;:\s]+$/, "")
}

export async function draftAnswer(input: {
  model: LanguageModel
  question: string
  jobDescription?: string
  profile: AiProfile
  corrections?: Correction[]
  maxLength?: number
}): Promise<string> {
  const maxLength = input.maxLength ?? AI_ANSWER_LENGTH_DEFAULT
  const profile = Object.entries(flattenProfile(input.profile))
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")
  const corrections = (input.corrections ?? []).map((c) => `Question: ${c.question}\nAnswer: ${c.answer}`).join("\n\n")

  const { text } = await generateText({
    model: input.model,
    system: SYSTEM,
    temperature: 0.4,
    prompt: [
      `Character limit: ${maxLength}`,
      dataBlock("profile", profile),
      ...(corrections ? [dataBlock("corrections", corrections)] : []),
      ...(input.jobDescription ? [dataBlock("job_description", input.jobDescription)] : []),
      dataBlock("question", input.question),
    ].join("\n\n"),
  })
  return fitLength(text, maxLength)
}
