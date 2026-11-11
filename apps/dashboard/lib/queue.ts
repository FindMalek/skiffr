import type { Job, JobCounts } from "@skiffr/common/schemas"

/** Rows added per "Show more". The query asks for one extra row so the page knows whether there is more. */
export const QUEUE_PAGE = 50
export const QUEUE_SHOWN_MAX = 400

export type StatusFilter = Job["status"] | "all"
export type JobStatus = Job["status"]

export type JobListInput = {
  limit: number
  status?: Job["status"]
  source?: string
  q?: string
  order: "newest" | "oldest"
}

export type QueueFilters = { status: StatusFilter; source: string; q: string }

export const DEFAULT_FILTERS: QueueFilters = { status: "queued", source: "", q: "" }

/** The queue is worked oldest first, every other view newest first. */
export function listInput(filters: QueueFilters, shown: number = QUEUE_PAGE): JobListInput {
  return {
    limit: Math.min(shown, QUEUE_SHOWN_MAX) + 1,
    ...(filters.status === "all" ? {} : { status: filters.status }),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    order: filters.status === "queued" ? "oldest" : "newest",
  }
}

export type Intent =
  | { kind: "status"; ids: readonly string[]; status: "queued" | "skipped" }
  | { kind: "applied"; ids: readonly string[] }
  | { kind: "remove"; ids: readonly string[] }

const targetStatus = (intent: Intent): JobStatus | null =>
  intent.kind === "remove" ? null : intent.kind === "applied" ? "applied" : intent.status

/** What an intent does to a row, as the server will: an applied job can't be skipped or queued by hand. */
const changes = (intent: Intent, row: Job): boolean => {
  const to = targetStatus(intent)
  if (to === null) return true
  if (intent.kind === "status" && row.status === "applied") return false
  return row.status !== to
}

export function matches(input: JobListInput, row: Job): boolean {
  if (input.status && row.status !== input.status) return false
  if (input.source && row.source !== input.source) return false
  if (input.q) {
    const needle = input.q.toLowerCase()
    if (!row.company.toLowerCase().includes(needle) && !row.title.toLowerCase().includes(needle)) return false
  }
  return true
}

function compare(order: JobListInput["order"]) {
  const sign = order === "oldest" ? 1 : -1
  return (a: Job, b: Job) => {
    const time = a.queuedAt.getTime() - b.queuedAt.getTime()
    if (time !== 0) return sign * time
    return sign * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }
}

/**
 * The rows of a cached list after an intent. A removed row goes at once; a row whose status changed shows its new
 * status but keeps its place until the server has answered (`pruneList`), so a second click on the same spot can't
 * land on the row that would slide up under the pointer.
 */
export function applyToList(list: readonly Job[], _input: JobListInput, intent: Intent): Job[] {
  const ids = new Set(intent.ids)
  const to = targetStatus(intent)
  const next: Job[] = []
  for (const row of list) {
    if (!ids.has(row.id) || !changes(intent, row)) next.push(row)
    else if (to !== null) next.push({ ...row, status: to })
  }
  return next
}

/** Drops the confirmed rows that the list's filter no longer matches. */
export function pruneList(list: readonly Job[], input: JobListInput, ids: readonly string[]): Job[] {
  return list.filter((row) => !ids.includes(row.id) || matches(input, row))
}

/** Puts the rows a failed intent touched back as they were: only those rows, so other optimistic changes stay. */
export function revertList(list: readonly Job[], input: JobListInput, before: readonly Job[]): Job[] {
  const byId = new Map(before.map((row) => [row.id, row]))
  const next = list.map((row) => byId.get(row.id) ?? row)
  const present = new Set(next.map((row) => row.id))
  const missing = before.filter((row) => !present.has(row.id) && matches(input, row))
  return missing.length ? [...next, ...missing].sort(compare(input.order)) : next
}

function bump(counts: JobCounts, row: Job, status: JobStatus | null, sign: 1 | -1): JobCounts {
  const next: JobCounts = { status: { ...counts.status }, sources: counts.sources.map((s) => ({ ...s })) }
  if (status === null) {
    next.status[row.status] += sign
    const entry = next.sources.find((s) => s.source === row.source)
    if (entry) entry.count += sign
    else if (sign === 1) next.sources.push({ source: row.source, count: 1 })
    next.sources = next.sources.filter((s) => s.count > 0)
    next.sources.sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : 1))
    return next
  }
  next.status[row.status] -= sign
  next.status[status] += sign
  return next
}

export function applyToCounts(counts: JobCounts, before: readonly Job[], intent: Intent): JobCounts {
  const to = targetStatus(intent)
  return before
    .filter((row) => intent.ids.includes(row.id) && changes(intent, row))
    .reduce((acc, row) => bump(acc, row, to, to === null ? -1 : 1), counts)
}

export function revertCounts(counts: JobCounts, before: readonly Job[], intent: Intent): JobCounts {
  const to = targetStatus(intent)
  return before
    .filter((row) => intent.ids.includes(row.id) && changes(intent, row))
    .reduce((acc, row) => bump(acc, row, to, to === null ? 1 : -1), counts)
}

export const STATUS_LABEL: Record<JobStatus, string> = { queued: "Queued", applied: "Applied", skipped: "Skipped" }

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by hand",
  gmail: "Gmail alert",
  extension: "Extension",
  careers: "Careers page",
}

/** Known sources get a plain name; anything else is shown as it was stored (already text, never markup). */
export const sourceLabel = (source: string): string => SOURCE_LABEL[source] ?? source
