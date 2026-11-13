import { createHash } from "node:crypto"
import { mockEmbeddingModel } from "@skiffr/ai/testing"
import { EMBEDDING_DIMENSIONS } from "@skiffr/common/constants"
import { normalizeLabel } from "@skiffr/common/utils"
import type { EmbeddingModel } from "ai"

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "period",
  "date",
  "to",
  "do",
  "does",
  "you",
  "your",
  "are",
  "is",
  "be",
  "have",
  "has",
  "will",
  "can",
  "what",
  "how",
  "when",
  "please",
  "for",
  "in",
  "on",
  "at",
  "with",
  "we",
  "our",
  "and",
  "or",
  "any",
  "if",
  "this",
  "that",
  "i",
])

/** Words that mean the same thing in a form, so "compensation" and "salary" land on one dimension. */
const SYNONYMS: Record<string, string> = {
  compensation: "salary",
  pay: "salary",
  wage: "salary",
  remuneration: "salary",
  ctc: "salary",
  rate: "salary",
  availability: "start",
  available: "start",
  notice: "start",
  begin: "start",
  starting: "start",
  mobile: "phone",
  telephone: "phone",
  cell: "phone",
  tel: "phone",
  employer: "company",
  organisation: "company",
  organization: "company",
  firm: "company",
  title: "role",
  position: "role",
  designation: "role",
  college: "school",
  university: "school",
  degree: "education",
  qualification: "education",
  relocate: "relocation",
  move: "relocation",
  relocating: "relocation",
  visa: "sponsorship",
  sponsor: "sponsorship",
  authorized: "authorization",
  authorised: "authorization",
  heard: "source",
  referral: "source",
  found: "source",
  city: "location",
  town: "location",
  based: "location",
  residence: "location",
}

const stem = (word: string) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word)

const tokensOf = (text: string): string[] =>
  normalizeLabel(text)
    .split(" ")
    .filter((word) => word && !STOPWORDS.has(word))
    .map((word) => SYNONYMS[stem(word)] ?? SYNONYMS[word] ?? stem(word))

/**
 * A deterministic stand-in for an embedding provider: every word is hashed onto a few of the 1536 dimensions, so two
 * questions that share their meaningful words (after stopwords, plurals and a small synonym list) are near in cosine
 * distance and unrelated ones are not. Good enough to click through similar-question suggestions without a key, nothing more.
 */
export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  const tokens = tokensOf(text)
  for (const token of tokens.length > 0 ? tokens : ["empty"]) {
    const digest = createHash("sha256").update(token).digest()
    for (let i = 0; i < 4; i++) {
      const dimension = digest.readUInt16BE(i * 2) % EMBEDDING_DIMENSIONS
      vector[dimension] = (vector[dimension] ?? 0) + (digest[8 + i]! % 2 === 0 ? 1 : -1)
    }
  }
  const norm = Math.hypot(...vector) || 1
  return vector.map((value) => value / norm)
}

/** For the api when `SEED=preview` and no embedding provider key is set. */
export const fakeEmbeddingModel = (): EmbeddingModel => mockEmbeddingModel(fakeEmbedding)
