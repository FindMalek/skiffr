import type { ActivityEvent, ExtensionStatus, JobCounts } from "@skiffr/common/schemas"
import type { Route } from "next"
import { dismissalKey } from "@/lib/answers"
import { type Completeness, completeness, profileToForm, type SavedProfile } from "@/lib/profile-form"

/** One section of the Today page: its query either worked or it did not. A failed one renders its own error box. */
export type Loaded<T> = { ok: true; value: T } | { ok: false }

export type SetupItem = {
  id: "profile" | "extension" | "job" | "application" | "answer"
  done: boolean
  label: string
  detail: string
  action: string
  href: Route
  /** Last time the extension was seen, for the relative time next to it. */
  lastSeenAt: Date | null
  tone: "neutral" | "warning"
  toneWord: string
}

export type SetupInput = {
  profile?: Completeness
  extension?: ExtensionStatus
  /** Jobs in the queue, applied or skipped: any job counts as the first one. */
  jobs?: number
  applications?: number
  /** Answers the user confirmed or rejected (not the ones skiffr learned alone). */
  reviewedAnswers?: number
}

/** The same count the profile page shows ("17 of 21 fields the extension can fill"). */
export function profileProgress(saved: SavedProfile | null): Completeness {
  return completeness(profileToForm(saved))
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`
}

/** Only the parts that loaded: a failed query leaves its item out and gets its own error box. */
export function setupItems(input: SetupInput): SetupItem[] {
  const items: SetupItem[] = []
  if (input.profile) {
    const { filled, total, missing } = input.profile
    items.push({
      id: "profile",
      done: missing.length === 0,
      label: "Fill your profile",
      detail: `${filled} of ${total} fields the extension can fill`,
      action: "Fill in your profile",
      href: "/settings/profile",
      lastSeenAt: null,
      tone: "neutral",
      toneWord: "To do",
    })
  }
  if (input.extension) {
    const { state, lastSeenAt } = input.extension
    items.push({
      id: "extension",
      done: state === "connected",
      label: "Connect the extension",
      detail: state === "connected" ? "Connected" : state === "stale" ? "Not seen lately" : "Not connected yet",
      action: state === "never" ? "Set up the extension" : "Check the extension",
      href: "/settings/extension",
      lastSeenAt,
      tone: state === "stale" ? "warning" : "neutral",
      toneWord: state === "stale" ? "Needs attention" : "To do",
    })
  }
  if (input.jobs !== undefined) {
    items.push({
      id: "job",
      done: input.jobs > 0,
      label: "Add your first job",
      detail:
        input.jobs > 0 ? `${plural(input.jobs, "job")} on the queue` : "Paste a link, or let Gmail alerts add one",
      action: "Open the queue",
      href: "/queue",
      lastSeenAt: null,
      tone: "neutral",
      toneWord: "To do",
    })
  }
  if (input.applications !== undefined) {
    items.push({
      id: "application",
      done: input.applications > 0,
      label: "Make your first application",
      detail:
        input.applications > 0
          ? `${plural(input.applications, "application")} so far`
          : "Apply to a job from the queue",
      action: "Open the queue",
      href: "/queue",
      lastSeenAt: null,
      tone: "neutral",
      toneWord: "To do",
    })
  }
  if (input.reviewedAnswers !== undefined) {
    items.push({
      id: "answer",
      done: input.reviewedAnswers > 0,
      label: "Review your first answer",
      detail: input.reviewedAnswers > 0 ? "You confirmed or rejected an answer" : "Confirm an answer skiffr learned",
      action: "Open answers",
      href: "/answers",
      lastSeenAt: null,
      tone: "neutral",
      toneWord: "To do",
    })
  }
  return items
}

/** Human names for the source keys stored on a job. The raw key never shows on the page. */
export function sourceLabel(source: string): string {
  if (source === "manual") return "Added by hand"
  if (source === "extension") return "Extension"
  if (source.startsWith("gmail:")) return "Gmail alert"
  if (source.startsWith("watch:")) return `Careers page (${source.slice("watch:".length)})`
  return "Other source"
}

/** How a job got on the queue, as the end of "2 jobs queued ...". */
export function queuedVia(source: string): string {
  if (source === "manual") return "by hand"
  if (source === "extension") return "from the extension"
  if (source.startsWith("gmail:")) return "from Gmail alerts"
  if (source.startsWith("watch:")) return "from a careers page"
  return "from another source"
}

/** A sentence for a failed check. Unknown keys get the generic line, never the key itself. */
export function failedSourceText(source: string): string {
  if (source.startsWith("gmail:")) return "Gmail alerts failed to check"
  if (source.startsWith("watch:")) return `Careers page (${source.slice("watch:".length)}) failed to check`
  return "A job source failed to check"
}

const STAGE_TEXT = {
  applied: "applied",
  responded: "responded",
  interview: "interview",
  offer: "offer",
  rejected: "rejected",
} as const

/** Plain text from counts and short labels the api already cut and sanitised. Rendered as text, never as html. */
export function describeActivity(event: ActivityEvent): string {
  switch (event.kind) {
    case "jobs_queued":
      return `${plural(event.count, "job")} queued ${queuedVia(event.source)}`
    case "job_applied":
      return `Applied to ${event.title} at ${event.company}`
    case "application_stage":
      return `${event.title} at ${event.company}: ${STAGE_TEXT[event.stage]}`
    case "answer_learned":
      return `Learned an answer for ${event.label}`
    case "answer_corrected":
      return `Corrected the answer for ${event.label}`
    case "fields_filled":
      return `Filled ${plural(event.count, "field")} on ${event.site}`
    case "gmail_failed":
      return event.needsReconnect ? "Gmail needs to be reconnected" : "Gmail sync failed"
    case "source_failed":
      return failedSourceText(event.source)
    case "token_expired":
      return `Extension token ${event.name} expired`
  }
}

export function queueLine(counts: JobCounts["status"]): string {
  return `${plural(counts.queued, "job")} queued, ${counts.applied} applied, ${counts.skipped} skipped`
}

/** The review count is what `/answers` shows: keep cards the user dismissed in this browser do not count. */
export function countOpenReview(
  suggestions: Parameters<typeof dismissalKey>[0][],
  dismissed: ReadonlySet<string>,
): number {
  return suggestions.filter((s) => !(s.kind === "keep" && dismissed.has(dismissalKey(s)))).length
}

export function reviewLine(count: number): string {
  return count === 0 ? "No answers need review." : `${plural(count, "answer")} need${count === 1 ? "s" : ""} review.`
}

/** Applications per day from `stats.overview`: the last 7 days against the 7 before them. */
export function weekCompare(perDay: { day: string; count: number }[]): { thisWeek: number; previous: number } {
  const sorted = [...perDay].sort((a, b) => a.day.localeCompare(b.day))
  const sum = (rows: { count: number }[]) => rows.reduce((total, row) => total + row.count, 0)
  return { thisWeek: sum(sorted.slice(-7)), previous: sum(sorted.slice(-14, -7)) }
}

export function deltaText(thisWeek: number, previous: number): string {
  if (thisWeek === 0 && previous === 0) return "No applications in the last 14 days"
  const delta = thisWeek - previous
  if (delta === 0) return "Same as the 7 days before"
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta)} vs the 7 days before`
}

export type AttentionItem = { id: string; text: string; href: Route }
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Current problems only: a stale activity line is not an attention item. */
export function attentionItems(input: {
  now: Date
  gmail: { connected: boolean; status: string | null } | null
  sources: { status: string }[]
  tokens: { expiresAt: Date | null; revokedAt: Date | null }[]
}): AttentionItem[] {
  const items: AttentionItem[] = []
  if (input.gmail?.connected && input.gmail.status === "needs_reconnect") {
    items.push({ id: "gmail", text: "Gmail needs to be reconnected", href: "/settings/gmail" })
  }
  const failing = input.sources.filter((source) => source.status === "error").length
  if (failing > 0) {
    items.push({
      id: "sources",
      text: `${plural(failing, "careers page")} failed the last check`,
      href: "/settings/sources",
    })
  }
  const expiring = input.tokens.filter(
    (token) =>
      !token.revokedAt &&
      token.expiresAt !== null &&
      token.expiresAt.getTime() > input.now.getTime() &&
      token.expiresAt.getTime() <= input.now.getTime() + WEEK_MS,
  ).length
  if (expiring > 0) {
    items.push({
      id: "tokens",
      text: `${plural(expiring, "extension token")} ${expiring === 1 ? "expires" : "expire"} within 7 days`,
      href: "/settings/extension",
    })
  }
  return items
}
