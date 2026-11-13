import { normalizeLabel } from "@skiffr/common"

export type Candidate = { text: string; value?: string }
export type Match = { index: number; score: number }

export const MATCH_THRESHOLD = 0.7

const ALIASES = [
  ["us", "usa", "u s a", "united states", "united states of america", "america"],
  ["uk", "gb", "gbr", "great britain", "united kingdom", "britain", "england"],
  ["uae", "united arab emirates"],
  ["south korea", "korea republic of", "republic of korea", "korea"],
  ["czechia", "czech republic"],
  ["turkiye", "turkey"],
  ["russia", "russian federation"],
  ["vietnam", "viet nam"],
  ["netherlands", "the netherlands", "holland"],
]

const TRUE_WORDS = new Set(["yes", "y", "true", "1", "on", "checked", "agree", "agreed", "accept", "accepted"])
const FALSE_WORDS = new Set(["no", "n", "false", "0", "off", "unchecked", "disagree", "decline", "declined"])

export const isTruthy = (value: string) => TRUE_WORDS.has(normalizeLabel(value))
export const isFalsy = (value: string) => FALSE_WORDS.has(normalizeLabel(value))

let regionNames: Map<string, string> | undefined
let regionCodes: Map<string, string> | undefined

function loadRegions(): void {
  if (regionNames) return
  regionNames = new Map()
  regionCodes = new Map()
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" })
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b)
        const name = names.of(code)
        if (!name || name === code) continue
        regionNames.set(normalizeLabel(code), normalizeLabel(name))
        regionCodes?.set(normalizeLabel(name), normalizeLabel(code))
      }
    }
  } catch {}
}

/** The text plus everything that names the same thing: aliases, country codes and country names. */
function forms(text: string): Set<string> {
  loadRegions()
  const out = new Set([text])
  for (let pass = 0; pass < 2; pass++) {
    for (const form of [...out]) {
      for (const group of ALIASES) if (group.includes(form)) for (const alias of group) out.add(alias)
      const name = regionNames?.get(form)
      if (name) out.add(name)
      const code = regionCodes?.get(form)
      if (code) out.add(code)
    }
  }
  return out
}

function bigrams(text: string): string[] {
  const flat = text.replace(/ /g, "")
  return flat.length < 2 ? [flat] : Array.from({ length: flat.length - 1 }, (_, i) => flat.slice(i, i + 2))
}

function dice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const pool = new Map<string, number>()
  for (const item of b) pool.set(item, (pool.get(item) ?? 0) + 1)
  let hits = 0
  for (const item of a) {
    const left = pool.get(item) ?? 0
    if (left > 0) {
      hits++
      pool.set(item, left - 1)
    }
  }
  return (2 * hits) / (a.length + b.length)
}

function scoreOne(value: string, candidate: string): number {
  if (!value || !candidate) return 0
  if (value === candidate) return 1
  const left = forms(value)
  for (const form of forms(candidate)) if (left.has(form)) return 0.92
  if (candidate.startsWith(`${value} `) || candidate.endsWith(` ${value}`)) return 0.85
  if (candidate.length >= 4 && (value.startsWith(`${candidate} `) || value.endsWith(` ${candidate}`))) return 0.8
  const a = value.split(" ")
  const b = candidate.split(" ")
  const shared = a.filter((word) => b.includes(word)).length
  if (shared === a.length) return Math.max(0.72, (2 * shared) / (a.length + b.length))
  return dice(bigrams(value), bigrams(candidate)) * 0.9
}

function booleanScore(value: string, candidate: string): number {
  const first = candidate.split(" ")[0] ?? ""
  if (isTruthy(value) && TRUE_WORDS.has(first)) return 0.9
  if (isFalsy(value) && FALSE_WORDS.has(first)) return 0.9
  return 0
}

/**
 * Best candidate for a value ("USA" against "United States"), or null when nothing is close enough. An exact or alias
 * match wins outright. A weaker one (a prefix: "Remote" against "Remote - UK" and "Remote - US") that another
 * candidate comes close to is ambiguous and matches nothing, unless the candidates are ranked results of a search.
 */
export function matchOption(value: string, candidates: Candidate[], { ranked = false } = {}): Match | null {
  const wanted = normalizeLabel(value)
  if (!wanted) return null
  const scores = candidates.map((candidate) => {
    const text = normalizeLabel(candidate.text)
    const raw = candidate.value ? normalizeLabel(candidate.value) : ""
    return Math.max(scoreOne(wanted, text), scoreOne(wanted, raw), booleanScore(wanted, text))
  })
  let best: Match | null = null
  scores.forEach((score, index) => {
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { index, score }
  })
  const top = best as Match | null
  if (!top || ranked || top.score >= 0.9) return top
  const rival = scores.some(
    (score, index) => index !== top.index && score >= MATCH_THRESHOLD && score >= top.score - 0.05,
  )
  return rival ? null : top
}

/** Does what the control shows still amount to the value we wrote? Tolerates masks and reformatting. */
export function sameValue(shown: string, wanted: string): boolean {
  const exact = (text: string) => text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim()
  if (exact(shown) === exact(wanted)) return true
  const loose = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()
  const a = loose(shown)
  return a !== "" && a === loose(wanted)
}

const TWO_DIGIT_DIAL = new Set(
  "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98".split(
    " ",
  ),
)

/** Country calling codes are prefix free: 1 and 7 are one digit, the codes in the table two, every other code three. */
function dialLength(digits: string): number {
  if (digits.startsWith("1") || digits.startsWith("7")) return 1
  return TWO_DIGIT_DIAL.has(digits.slice(0, 2)) ? 2 : 3
}

const SHOWN_DIGITS_MIN = 5

/** Calling codes of countries that write the national number with a leading 0 (the trunk prefix), which a picker may show. */
const TRUNK_ZERO_DIAL = new Set(
  "20 27 31 32 33 36 40 41 43 44 46 49 61 64 81 82 90 91 92 212 213 353 358 380 971 972".split(" "),
)

/**
 * A phone widget with a country picker keeps the dial code out of the input: "+351 912 345 678" shows as "912 345 678",
 * or "07911 123456" for "+44 7911 123456" when the country writes its numbers with a trunk 0. What is left must be
 * exactly the number without its dial code, so a number the page cut short is not kept.
 */
export function movedDialCode(shown: string, wanted: string): boolean {
  if (!wanted.trim().startsWith("+")) return false
  const digits = (text: string) => text.replace(/\D/g, "")
  const all = digits(wanted)
  const length = dialLength(all)
  const rest = all.slice(length)
  const local = digits(shown)
  if (rest.length < SHOWN_DIGITS_MIN) return false
  return local === rest || (TRUNK_ZERO_DIAL.has(all.slice(0, length)) && local === `0${rest}`)
}

export function splitList(value: string | string[]): string[] {
  const parts = Array.isArray(value) ? value : value.split(/[\n;,]/)
  return parts.map((part) => part.trim()).filter(Boolean)
}
