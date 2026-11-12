const stripSuffix = (word: string): string => {
  if (word.length <= 3 || /[\d+#]/.test(word)) return word
  let out = word
  if (out.endsWith("ies") && out.length > 4) out = `${out.slice(0, -3)}y`
  else
    for (const suffix of ["ing", "ed", "es", "s"]) {
      if (out.endsWith(suffix) && out.length - suffix.length >= 3) {
        out = out.slice(0, -suffix.length)
        break
      }
    }
  return out.length > 3 && out.endsWith("e") ? out.slice(0, -1) : out
}

/** A crude stem, the same on both sides of every comparison: `managed`, `manages` and `managing` meet. */
export const stem = stripSuffix

const TOKEN = /\p{Nd}+(?:[.,]\p{Nd}+)*|[\p{L}\p{N}]+(?:[+#]+)?/gu

/** Invisible and format characters can't hide inside a word of the source: they are removed before anything is compared. */
const INVISIBLE = /[\p{Cf}\p{Cc}\p{Co}\p{Cs}]/gu

export const normalize = (text: string): string => text.normalize("NFKC")

export const comparable = (text: string): string => normalize(text).replace(INVISIBLE, " ").toLowerCase()

export function tokens(text: string): string[] {
  return comparable(text).match(TOKEN) ?? []
}

const CONFUSABLE = [/\p{Script=Cyrillic}/u, /\p{Script=Greek}/u, /\p{Script=Armenian}/u, /\p{Script=Cherokee}/u]
const LATIN = /\p{Script=Latin}/u

/** What a model's text may not contain: format or control characters (zero width joiners, bidi overrides), private use, digits of other scripts, and words that mix Latin letters with look-alike ones. */
export function hasUnicodeTrick(text: string): boolean {
  const folded = normalize(text)
  if (/[\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u.test(folded) || /\p{Cc}/u.test(folded.replace(/[\t\n\r]/g, ""))) return true
  if (/(?![0-9])\p{Nd}/u.test(folded)) return true
  for (const run of folded.match(/\p{L}+/gu) ?? []) {
    const scripts = CONFUSABLE.filter((script) => script.test(run)).length
    if (scripts > 1 || (scripts === 1 && LATIN.test(run))) return true
  }
  return false
}

/** A clause ends at a comma (not inside a number like 1,000), `;`, `:`, a line break or a sentence end. */
const CLAUSE_END = /(?<!\p{Nd}),|,(?!\p{Nd})|[;:\n]+|[.!?]+(?=\s|$)/u
const EDGE = /^[^\p{L}\p{N}$\u20ac\u00a3\u00a5]+|[^\p{L}\p{N}%+#]+$/gu
const FIGURE = /[\p{N}$\u20ac\u00a3\u00a5%]/u

/** The clauses of a text in the form they are compared in: folded, lowercase, one space, no edge punctuation. */
export function clausesOf(text: string): string[] {
  return comparable(text.replace(/\n+/g, ";"))
    .split(CLAUSE_END)
    .map((clause) => clause.replace(/\s+/g, " ").replace(EDGE, "").trim())
    .filter(Boolean)
}

/** What a piece of new text may be copied from: whole clauses, and the words of each clause in order. */
export interface Scope {
  whole: Set<string>
  words: string[][]
}

export function buildScope(units: readonly string[]): Scope {
  const clauses = units.flatMap(clausesOf)
  return { whole: new Set(clauses), words: clauses.map((clause) => clause.match(TOKEN) ?? []) }
}

const hasRun = (haystack: readonly string[], needle: readonly string[]): boolean => {
  for (let at = 0; at + needle.length <= haystack.length; at++) {
    if (needle.every((word, i) => haystack[at + i] === word)) return true
  }
  return false
}

/**
 * Whether every clause of `text` is the applicant's own. A clause with a number, a percent or a currency sign must be
 * copied whole, so a figure keeps its unit, its words and its entry. Any other clause may be copied whole or be a
 * stretch of two or more words from inside one clause, in the same order. Nothing is rewritten and no word is added.
 */
export function isCopied(text: string, scope: Scope): boolean {
  const clauses = clausesOf(text)
  if (clauses.length === 0) return false
  return clauses.every((clause) => {
    if (scope.whole.has(clause)) return true
    if (FIGURE.test(clause)) return false
    const words = clause.match(TOKEN) ?? []
    return words.length >= 2 && scope.words.some((source) => hasRun(source, words))
  })
}

export const squash = (text: string): string => normalize(text).replace(/\s+/g, " ").trim()
