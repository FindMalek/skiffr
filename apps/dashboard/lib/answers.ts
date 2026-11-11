import { ANSWERS_PER_USER_MAX, CLEARED_STOP_MIN, LIST_LIMIT_MAX, SUGGEST_STALE_DAYS } from "@skiffr/common/constants"
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
const INVISIBLE = /[­᠎​⁠﻿‪-‮⁦-⁩]/g

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

/** The list route returns at most `LIST_LIMIT_MAX` rows a call and has no search or sort, so read every page and work on the whole bank here. */
export async function fetchAllAnswers(client: Pick<AppRouterClient, "answers">): Promise<Answer[]> {
  const all: Answer[] = []
  while (all.length <= ANSWERS_PER_USER_MAX) {
    const page = await client.answers.list({ limit: LIST_LIMIT_MAX, offset: all.length })
    all.push(...page)
    if (page.length < LIST_LIMIT_MAX) break
  }
  return all
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

/** Plain sentences around the label and value, which the card renders as separate text nodes. */
export function suggestionCopy(kind: SuggestionKind, count: number): SuggestionCopy {
  switch (kind) {
    case "keep":
      return {
        title: "Keep as your default?",
        question: `You corrected this to the same answer ${count} times.`,
        primary: { label: "Keep", decision: "keep" },
        secondary: { label: "Dismiss", decision: null },
      }
    case "flip_flop":
      return {
        title: "This answer keeps changing",
        question: `You changed it ${count} times and not to the same thing. Stop filling it and ask each time?`,
        primary: { label: "Stop auto filling", decision: "reject" },
        secondary: { label: "Keep anyway", decision: "keep" },
      }
    case "cleared":
      return {
        title: "You keep clearing this",
        question: `You emptied it ${count} times in a row. Stop filling it? (skiffr stops by itself after ${CLEARED_STOP_MIN}.)`,
        primary: { label: "Stop filling", decision: "reject" },
        secondary: { label: "Keep filling", decision: "keep" },
      }
    case "stale":
      return {
        title: "Still right?",
        question: `Nothing changed here for ${SUGGEST_STALE_DAYS} days.`,
        primary: { label: "Still right", decision: "keep" },
        secondary: { label: "Stop filling", decision: "reject" },
      }
  }
}

/** Status an answer gets after a decision, so the table can follow before the server answers. */
export function statusAfter(decision: "keep" | "reject"): AnswerStatus {
  return decision === "keep" ? "confirmed" : "rejected"
}

/** The id of a dismissed `keep` card stays tied to the answer's last change, so a changed answer asks again. */
export function dismissalKey(answer: Pick<Answer, "id" | "updatedAt">): string {
  return `${answer.id}:${answer.updatedAt.getTime()}`
}

export interface TrendPoint {
  applicationId: string
  appliedAt: Date
  correctionsPerField: number
}

/** One sentence for the corrections trend: first half of the window against the second. */
export function trendSentence(points: TrendPoint[]): string {
  if (points.length < 2) return "Not enough applications yet to show a trend."
  const mid = Math.floor(points.length / 2)
  const mean = (rows: TrendPoint[]) => rows.reduce((sum, p) => sum + p.correctionsPerField, 0) / rows.length
  const before = mean(points.slice(0, mid))
  const after = mean(points.slice(mid))
  const fmt = (n: number) => n.toFixed(2)
  if (Math.abs(after - before) < 0.005) return `Corrections per field are steady at ${fmt(after)}.`
  return `Corrections per field went ${after < before ? "down" : "up"} from ${fmt(before)} to ${fmt(after)}.`
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
