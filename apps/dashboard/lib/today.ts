import type { ActivityEvent, ExtensionStatus, Job, JobCounts } from "@skiffr/common/schemas"
import { type Completeness, completeness, profileToForm, type SavedProfile } from "@/lib/profile-form"

/** One section of the Today page: its query either worked or it did not. A failed one renders its own error box. */
export type Loaded<T> = { ok: true; value: T } | { ok: false }

export type QueueSnapshot = { counts: JobCounts; next: Job | null }

export type TodayData = {
  queue: Loaded<QueueSnapshot>
  profile: Loaded<SavedProfile | null>
  extension: Loaded<ExtensionStatus>
  /** Answers the review queue (`learning.suggestions`) wants a decision on. */
  review: Loaded<number>
  activity: Loaded<ActivityEvent[]>
}

export type SetupItem = {
  id: "profile" | "extension"
  done: boolean
  label: string
  detail: string
  action: string
  href: "/settings/profile" | "/settings/extension"
  /** Last time the extension was seen, for the relative time next to it. */
  lastSeenAt: Date | null
  tone: "neutral" | "warning"
  toneWord: string
}

/** The same count the profile page shows ("17 of 21 fields the extension can fill"). */
export function profileProgress(saved: SavedProfile | null): Completeness {
  return completeness(profileToForm(saved))
}

/** Only the parts that loaded: a failed query leaves its item out and gets its own error box. */
export function setupItems(input: { profile?: Completeness; extension?: ExtensionStatus }): SetupItem[] {
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
  return items
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`
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
      return `${plural(event.count, "job")} queued from ${event.source}`
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
      return `Checking ${event.source} failed`
    case "token_expired":
      return `Extension token ${event.name} expired`
  }
}

export function queueLine(counts: JobCounts["status"]): string {
  return `${plural(counts.queued, "job")} queued, ${counts.applied} applied, ${counts.skipped} skipped`
}

export function reviewLine(count: number): string {
  return count === 0 ? "No answers need review." : `${plural(count, "answer")} need${count === 1 ? "s" : ""} review.`
}
