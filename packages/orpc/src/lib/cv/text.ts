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
const SENTENCE_END = /[.!?]+(?=\s|$)/u
const EDGE = /^[^\p{L}\p{N}$\u20ac\u00a3\u00a5]+|[^\p{L}\p{N}%+#]+$/gu

/** What a clause is compared by: folded, lowercase, one space, no punctuation or symbol at its edges. */
const keyOf = (clause: string): string => comparable(clause).replace(/\s+/g, " ").replace(EDGE, "").trim()

export interface Clause {
  /** The clause as the source wrote it. */
  raw: string
  key: string
}

export function clausesOf(text: string): Clause[] {
  return normalize(text.replace(/\n+/g, " ; "))
    .replace(INVISIBLE, " ")
    .split(CLAUSE_END)
    .map((piece) => {
      const raw = piece.replace(/\s+/g, " ").trim()
      return { raw, key: keyOf(raw) }
    })
    .filter((clause) => clause.key.length > 0)
}

/** The whole clauses a new text may be made of, by comparison key, each with the source's own wording. */
export type Scope = Map<string, string>

export function buildScope(units: readonly string[]): Scope {
  const scope: Scope = new Map()
  for (const unit of units) for (const { raw, key } of clausesOf(unit)) if (!scope.has(key)) scope.set(key, raw)
  return scope
}

const capital = (text: string): string => text.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase())

/**
 * Rebuilds `text` from the source's own clauses, or null if any clause of it is not one. Only whole clauses count: a
 * clause is never cut, so a "not", "no" or "assisted" can't be dropped and a figure keeps its unit, its words and its
 * entry. Clauses can be dropped and reordered. What comes back is the source's wording, so a symbol, a change of case
 * or an angle bracket from the model never makes it in. `paragraphs` keeps sentences (with a full stop) and lines;
 * `line` joins everything into one line with commas.
 */
export function copyOf(text: string, scope: Scope, shape: "line" | "paragraphs"): string | null {
  const lines: string[] = []
  for (const line of normalize(text).split(/\n+/)) {
    const sentences: string[] = []
    for (const sentence of line.split(SENTENCE_END)) {
      const parts: string[] = []
      for (const { key } of clausesOf(sentence)) {
        const raw = scope.get(key)
        if (raw === undefined) return null
        parts.push(raw)
      }
      if (parts.length > 0) sentences.push(parts.join(", "))
    }
    if (sentences.length > 0)
      lines.push(shape === "paragraphs" ? sentences.map((s) => `${capital(s)}.`).join(" ") : sentences.join(", "))
  }
  if (lines.length === 0) return null
  return shape === "paragraphs" ? lines.join("\n") : lines.join(", ")
}

/** The clauses of a text as a list of keys, to tell whether two texts say the same. */
export const clauseKeys = (text: string): string[] => clausesOf(text).map((clause) => clause.key)

export const squash = (text: string): string => normalize(text).replace(/\s+/g, " ").trim()
