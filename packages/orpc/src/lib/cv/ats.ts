import type { CvAts } from "@skiffr/common/schemas"
import { stem } from "./text"

const KEYWORDS_MAX = 30
const WORD_MAX = 24

/** Words that say nothing about fit: connectors and the boilerplate every posting has. */
const SKIP = new Set(
  `a able about above across after all also an and any are as at be been being between both but by can could do does each etc
  for from get give had has have having help how i if in into is it its just like make may more most must need new no not of on
  one only or our out over own per should so some such than that the their them then there these they this those through to
  up us use used using very want was we well were what when where which while who will with within without would you your
  ignore ignored previous instruction instructions disregard override pretend assistant prompt system resume cv
  ability about apply applicant applicants benefits candidate candidates career careers company culture day deliver
  description diverse employer employees equal excellent experience experienced following full good great growing
  include including inclusive job join knowledge looking love opportunities opportunity part passion passionate people
  perks plus position preferred qualifications required requirements responsibilities responsibility role salary
  seeking skills strong team teams time understanding variety week work working year years`
    .split(/\s+/)
    .filter(Boolean),
)

const WORD = /[\p{L}\p{N}][\p{L}\p{N}]*(?:[.+#][\p{L}\p{N}]+|[+#]+)*/gu

const words = (text: string): string[] =>
  (text.normalize("NFKC").toLowerCase().match(WORD) ?? []).map((word) => word.replace(/\.+$/, ""))

/** The posting's most repeated meaningful words, most repeated first (ties keep the order of the posting). */
export function jobKeywords(description: string): string[] {
  const seen = new Map<string, { word: string; count: number; first: number }>()
  words(description).forEach((word, first) => {
    if (word.length < 2 || word.length > WORD_MAX || /^\d/.test(word) || SKIP.has(word)) return
    const key = stem(word)
    const entry = seen.get(key)
    if (entry) entry.count++
    else seen.set(key, { word, count: 1, first })
  })
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, KEYWORDS_MAX)
    .map((entry) => entry.word)
}

/**
 * How many of the posting's keywords the resume's visible text contains. Plain counting, the same every time: no model
 * is asked for a number. A keyword counts when the resume has the word or a form of it (`deploy`, `deployed`).
 */
export function atsScore(resumeTexts: readonly string[], description: string): CvAts {
  const keywords = jobKeywords(description)
  const have = new Set(resumeTexts.flatMap((text) => words(text).map(stem)))
  const matched = keywords.filter((word) => have.has(stem(word)))
  const missing = keywords.filter((word) => !have.has(stem(word)))
  return {
    score: keywords.length === 0 ? 0 : Math.round((matched.length / keywords.length) * 100),
    total: keywords.length,
    matched,
    missing,
  }
}
