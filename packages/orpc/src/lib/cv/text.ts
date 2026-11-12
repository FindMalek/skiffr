/** Words that carry no fact: connectors and plain action verbs. Nothing that names a tool, a title, a number or a place belongs here. */
const PLAIN_WORDS = `a about above across after again against all also an and any are as at be been being between both but by can could did do does during
each early either end ends enough every for from further had has have having he her his how i if in into is it its just like made make
makes making many more most much my new no nor not of off on once one only onto or other our out over own per same she should since so
some such than that the their them then there these they this those through to too under until up upon us very was we were what when
where whether which while who whom why will with within without would you your achieved added aligned analyzed applied arranged
assembled assessed assisted automated balanced boosted brought built carried cleaned collaborated combined completed configured
connected contributed converted coordinated created cut debugged delivered deployed designed detected developed diagnosed documented
drove eliminated enabled enforced ensured established evaluated executed expanded facilitated finished fixed focused formed gathered
generated handled helped identified implemented improved increased initiated integrated introduced investigated launched maintained
measured merged migrated modernized monitored operated optimized organized performed planned prepared prevented produced progressed
proposed provided raised reduced refactored released remodeled replaced reported researched resolved restructured reviewed revised
rewrote scaled scheduled secured selected served set shaped shared shipped simplified solved sourced standardized streamlined
strengthened supported sustained tested tracked transformed translated tuned updated upgraded used validated verified wrote quickly
reliably successfully effectively directly closely independently together daily weekly regularly consistently across between during
across while using via per cross functional end-to-end`

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

export interface Vocab {
  words: Set<string>
  stems: Set<string>
  /** The source as one lowercase string, to find a whole phrase in. */
  text: string
}

const PLAIN = tokens(PLAIN_WORDS)
const PLAIN_STEMS = new Set(PLAIN.map(stem))
export const isPlainWord = (word: string): boolean => PLAIN_STEMS.has(stem(word))

/** Everything the applicant has written: only words found here (or plain connectors) may appear in reworded text. */
export function buildVocab(texts: readonly string[]): Vocab {
  const words = new Set<string>()
  const stems = new Set<string>()
  const parts: string[] = []
  for (const text of texts) {
    const list = tokens(text)
    for (const word of list) {
      words.add(word)
      stems.add(stem(word))
    }
    parts.push(list.join(" "))
  }
  return { words, stems, text: ` ${parts.join(" ")} ` }
}

/** The words of `text` that are not in the source: a number must match exactly, any other word may differ only by ending. */
export function newWords(text: string, vocab: Vocab): string[] {
  const unknown: string[] = []
  for (const word of tokens(text)) {
    if (/\d/.test(word)) {
      if (!vocab.words.has(word)) unknown.push(word)
    } else if (!vocab.words.has(word) && !vocab.stems.has(stem(word)) && !isPlainWord(word)) unknown.push(word)
  }
  return unknown
}

/** Whole-phrase match in the source, so `postgres` is found in "built on Postgres and Redis" but not inside `postgresql`. */
export function hasPhrase(phrase: string, vocab: Vocab): boolean {
  const words = tokens(phrase)
  return words.length > 0 && vocab.text.includes(` ${words.join(" ")} `)
}

export const squash = (text: string): string => normalize(text).replace(/\s+/g, " ").trim()
