import { ANSWERS_PER_USER_MAX, LIST_LIMIT_MAX, SUGGEST_STALE_DAYS } from "@skiffr/common/constants"
import type { Answer } from "@skiffr/common/schemas"
import type { AppRouterClient } from "@skiffr/orpc/client"

export type AnswerStatus = Answer["status"]
export type StatusFilter = "all" | AnswerStatus
export type SortKey = "recent" | "corrected" | "used" | "label"

export const PAGE_SIZE = 20

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "learned", label: "Learned" },
  { value: "confirmed", label: "Confirmed" },
  { value: "rejected", label: "Rejected" },
]

export const SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently corrected" },
  { value: "corrected", label: "Most corrected" },
  { value: "used", label: "Most used" },
  { value: "label", label: "Question A-Z" },
]

export const STATUS_TEXT: Record<AnswerStatus, string> = {
  learned: "Learned",
  confirmed: "Confirmed",
  rejected: "Rejected",
}

export const SOURCE_TEXT: Record<Answer["source"], string> = {
  autofill: "Learned from your corrections",
  manual: "Added by you",
  ai: "Drafted by AI",
  import: "Imported",
}

/** Characters that reorder or hide text around them. They are shown as `[U+XXXX]` instead of acting on the page. */
const INVISIBLE = /[\u00AD\u180E\u200B\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]/g

export function revealInvisible(text: string): string {
  return text.replace(
    INVISIBLE,
    (char) => `[U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}]`,
  )
}

const SEGMENTER = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined) : null

/** At most `max` visible characters, cut on a grapheme boundary so an emoji or a combined letter is never split. */
export function clip(text: string, max: number): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false }
  if (!SEGMENTER) {
    const chars = [...text]
    return chars.length <= max ? { text, clipped: false } : { text: chars.slice(0, max).join(""), clipped: true }
  }
  let out = ""
  let count = 0
  for (const { segment } of SEGMENTER.segment(text)) {
    if (count === max) return { text: out, clipped: true }
    out += segment
    count += 1
  }
  return { text: out, clipped: false }
}

/** What a page-controlled string looks like on screen: hidden characters revealed, long text cut. */
export function displayText(text: string, max: number): { text: string; clipped: boolean } {
  return clip(revealInvisible(text), max)
}

/** Case, accents and invisible characters do not matter when searching. */
export function foldForSearch(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replace(INVISIBLE, "").toLowerCase().replace(/\s+/g, " ").trim()
}

export function filterAnswers(answers: Answer[], query: string, status: StatusFilter): Answer[] {
  const needle = foldForSearch(query)
  return answers.filter(
    (row) =>
      (status === "all" || row.status === status) &&
      (needle === "" || foldForSearch(row.rawLabel).includes(needle) || row.normalizedLabel.includes(needle)),
  )
}

const time = (value: Date | null | undefined) => value?.getTime() ?? 0

const byLabel = (a: Answer, b: Answer) =>
  a.normalizedLabel < b.normalizedLabel ? -1 : a.normalizedLabel > b.normalizedLabel ? 1 : a.id < b.id ? -1 : 1

/** A new array, ties always fall back to the question so the order never jumps between renders. */
export function sortAnswers(answers: Answer[], sort: SortKey): Answer[] {
  const compare: Record<SortKey, (a: Answer, b: Answer) => number> = {
    recent: (a, b) => time(b.lastCorrectedAt) - time(a.lastCorrectedAt),
    corrected: (a, b) => b.timesCorrected - a.timesCorrected,
    used: (a, b) => b.timesUsed - a.timesUsed,
    label: () => 0,
  }
  return [...answers].sort((a, b) => compare[sort](a, b) || byLabel(a, b))
}

export function paginate<T>(rows: T[], page: number, size = PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(Math.max(1, page), pages)
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages }
}

/**
 * The list route returns at most `LIST_LIMIT_MAX` rows a call and has no search or sort, so read every page and work on the
 * whole bank here. A small bank costs one call, a big one reads the rest of its pages in parallel. Pages are by offset on a
 * list that can change underneath, so rows are de-duplicated by id and put in a fixed order.
 */
export async function fetchAllAnswers(client: Pick<AppRouterClient, "answers">): Promise<Answer[]> {
  const rows = new Map<string, Answer>()
  const read = async (offset: number) => {
    const page = await client.answers.list({ limit: LIST_LIMIT_MAX, offset })
    for (const row of page) rows.set(row.id, row)
    return page
  }
  const first = await read(0)
  if (first.length === LIST_LIMIT_MAX) {
    const pages = Math.ceil(ANSWERS_PER_USER_MAX / LIST_LIMIT_MAX)
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => read((i + 1) * LIST_LIMIT_MAX)))
    let last = rest[rest.length - 1]
    for (
      let offset = pages * LIST_LIMIT_MAX;
      last?.length === LIST_LIMIT_MAX && offset <= ANSWERS_PER_USER_MAX * 2;
      offset += LIST_LIMIT_MAX
    ) {
      last = await read(offset)
    }
  }
  return [...rows.values()].sort(byLabel)
}

export type SuggestionKind = "keep" | "flip_flop" | "cleared" | "stale"

export interface SuggestionCopy {
  title: string
  question: string
  /** What the primary button does. */
  primary: { label: string; decision: "keep" | "reject" }
  /** The other button. `null` decision: only hides the card on this browser. */
  secondary: { label: string; decision: "keep" | "reject" | null }
}

const STOP = { label: "Stop filling", decision: "reject" } as const
const KEEP = { label: "Keep", decision: "keep" } as const

/** Plain sentences around the label and value, which the card renders as separate text nodes. */
export function suggestionCopy(kind: SuggestionKind, count: number): SuggestionCopy {
  switch (kind) {
    case "keep":
      return {
        title: "Make this your default?",
        question: `You changed this to the same answer ${count} times.`,
        primary: KEEP,
        secondary: { label: "Dismiss", decision: null },
      }
    case "flip_flop":
      return {
        title: "This answer keeps changing",
        question: `You gave ${count} different answers. Stop filling it and ask each time instead?`,
        primary: STOP,
        secondary: KEEP,
      }
    case "cleared":
      return {
        title: "You keep clearing this",
        question: `You emptied it ${count} times in a row, so skiffr already stopped filling it but still offers it. Stop filling to never offer it, or keep it to fill it again.`,
        primary: STOP,
        secondary: KEEP,
      }
    case "stale":
      return {
        title: "Still right?",
        question: `You have not changed or confirmed this in ${SUGGEST_STALE_DAYS} days.`,
        primary: KEEP,
        secondary: STOP,
      }
  }
}

/** Status an answer gets after a decision, so the table can follow before the server answers. */
export function statusAfter(decision: "keep" | "reject"): AnswerStatus {
  return decision === "keep" ? "confirmed" : "rejected"
}

/** What the edit dialog says saving does. The server confirms an answer on every manual save, a rejected one included. */
export function editNotice(status: AnswerStatus): string {
  return status === "rejected"
    ? "skiffr is not filling this one. Saving restores it and marks it confirmed."
    : "Saving by hand marks it confirmed, so skiffr keeps using it."
}

// ---- optimistic cache edits: pure, so a repeat of the same click changes nothing the second time ----

interface WithAnswer {
  answer: Answer
}
export interface Cache<S extends WithAnswer> {
  bank: Answer[]
  suggestions: S[]
}
export interface RowSnapshot<S extends WithAnswer> {
  answer: Answer | undefined
  suggestions: S[]
}

export function snapshotRow<S extends WithAnswer>(cache: Cache<S>, id: string): RowSnapshot<S> {
  return {
    answer: cache.bank.find((row) => row.id === id),
    suggestions: cache.suggestions.filter((s) => s.answer.id === id),
  }
}

/** The answer gets the status the click asked for, never a status worked out from what is cached; its suggestions go. */
export function applyDecision<S extends WithAnswer>(
  cache: Cache<S>,
  id: string,
  decision: "keep" | "reject",
): Cache<S> {
  const status = statusAfter(decision)
  return {
    bank: cache.bank.map((row) => (row.id === id && row.status !== status ? { ...row, status } : row)),
    suggestions: cache.suggestions.filter((s) => s.answer.id !== id),
  }
}

export function applyRemoval<S extends WithAnswer>(cache: Cache<S>, id: string): Cache<S> {
  return {
    bank: cache.bank.filter((row) => row.id !== id),
    suggestions: cache.suggestions.filter((s) => s.answer.id !== id),
  }
}

/** Puts back only this row, so a failure never undoes what another row's request changed meanwhile. */
export function restoreRow<S extends WithAnswer>(cache: Cache<S>, before: RowSnapshot<S>, id: string): Cache<S> {
  const bank = before.answer
    ? cache.bank.some((row) => row.id === id)
      ? cache.bank.map((row) => (row.id === id ? before.answer! : row))
      : [...cache.bank, before.answer]
    : cache.bank
  return { bank, suggestions: [...cache.suggestions.filter((s) => s.answer.id !== id), ...before.suggestions] }
}

/** Ids with a request in flight. A second click on the same row is ignored until the first one ends. */
export function createInflight() {
  const ids = new Set<string>()
  return {
    start: (id: string) => {
      if (ids.has(id)) return false
      ids.add(id)
      return true
    },
    end: (id: string) => void ids.delete(id),
  }
}

// ---- dismissed "make this your default?" cards, remembered in this browser only ----

/** Small non-cryptographic hash, so the stored key says nothing about the answer's text. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(36)
}

/** A dismissal holds for this answer, this kind of card and this exact value: using the answer does not bring the card back, changing it does. */
export function dismissalKey(suggestion: { kind: SuggestionKind; answer: Pick<Answer, "id" | "value"> }): string {
  return `${suggestion.answer.id}:${suggestion.kind}:${hashText(suggestion.answer.value)}`
}

export const DISMISSED_MAX = 200

/** Anything but a list of short strings is treated as empty: another script or an old build may have written this key. */
export function parseDismissed(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string" && item.length <= 100).slice(-DISMISSED_MAX)
  } catch {
    return []
  }
}

export interface TrendPoint {
  applicationId: string
  appliedAt: Date
  /** Share of the filled fields the user changed, 0 to 1. */
  correctionsPerField: number
}

export const percent = (share: number) => `${Math.round(share * 100)}%`

/** One sentence for the trend: the first half of the window against the second. */
export function trendSentence(points: TrendPoint[]): string {
  if (points.length < 2) return "Not enough applications yet to show a trend."
  const mid = Math.floor(points.length / 2)
  const mean = (rows: TrendPoint[]) => rows.reduce((sum, p) => sum + p.correctionsPerField, 0) / rows.length
  const before = mean(points.slice(0, mid))
  const after = mean(points.slice(mid))
  if (percent(before) === percent(after)) return `You edit ${percent(after)} of what skiffr fills, steady.`
  return `You edit ${percent(after)} of what skiffr fills, ${after < before ? "down" : "up"} from ${percent(before)}.`
}

export function countByStatus(answers: Answer[]): Record<AnswerStatus, number> {
  const counts: Record<AnswerStatus, number> = { learned: 0, confirmed: 0, rejected: 0 }
  for (const row of answers) counts[row.status] += 1
  return counts
}

/** Announced to screen readers after the list changes. */
export function resultsSentence(shown: number, total: number, sort: SortKey): string {
  const sorted = SORTS.find((s) => s.value === sort)?.label.toLowerCase() ?? ""
  if (total === 0) return "No answers yet."
  if (shown === 0) return "No answers match."
  return `${shown} of ${total} answers, sorted by ${sorted}.`
}

/** The cache key of the whole bank: the list route's key plus a suffix, so invalidating the route refetches it. */
export const bankKey = (base: readonly unknown[]) => [...base, "bank"] as const

// One fixed format, in UTC: the server and every browser print the same text, whatever their locale or timezone.
const DAY = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
export const formatDay = (value: Date) => DAY.format(value)
