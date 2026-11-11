import { createHash } from "node:crypto"
import { controlKind } from "@skiffr/ai"
import {
  CLEARED_STOP_MIN,
  LEARNING_AUTOFILL_VALUE_MAX,
  SITE_PROFILE_OVERLAP_MIN,
  SITE_PROFILE_PARTIAL_MAX,
  SITE_PROFILES_PER_SITE_MAX,
  SITE_PROFILES_PER_USER_MAX,
} from "@skiffr/common/constants"
import type { SiteFieldEntry, SiteFieldMap } from "@skiffr/common/schemas"
import { type Db, siteProfile } from "@skiffr/db"
import { and, desc, eq, inArray, ne, type SQL, sql } from "drizzle-orm"

/** The distinct field keys of a form, sorted: the same form always gives the same list, whatever order its fields are in. */
export const formFieldKeys = (keys: string[]): string[] => [...new Set(keys)].sort()

/** Stable hash of a form's field keys (label and control type, not options). The server computes it from what it is sent, so a client can't pick one. */
export const formSignature = (keys: string[]): string =>
  createHash("sha256").update(formFieldKeys(keys).join("\n")).digest("hex").slice(0, 32)

/** Shared fields over the larger of the two forms: adding or dropping one field of five still matches, swapping two doesn't. */
export function overlap(a: string[], b: string[]): number {
  const left = new Set(a)
  const right = new Set(b)
  const size = Math.max(left.size, right.size)
  if (size === 0) return 0
  let shared = 0
  for (const key of left) if (right.has(key)) shared++
  return shared / size
}

type Saved = { id: string; fieldKeys: string[]; lastUsedAt: Date }

/** The most alike saved form (at least `SITE_PROFILE_OVERLAP_MIN` in common), ties to the most recently used. The exact form is read by its key before this. */
export function pickAlikeForm<T extends Saved>(candidates: T[], keys: string[]): T | null {
  let best: { row: T; score: number } | null = null
  for (const row of candidates) {
    const score = overlap(row.fieldKeys, keys)
    if (score < SITE_PROFILE_OVERLAP_MIN) continue
    if (!best || score > best.score || (score === best.score && row.lastUsedAt > best.row.lastUsedAt)) {
      best = { row, score }
    }
  }
  return best?.row ?? null
}

/** A batch that is a strict subset of a known form and covers under half of it: the client left fields out, so it isn't a form of its own. */
export function isPartialForm(known: string[], keys: string[]): boolean {
  const all = new Set(known)
  const batch = new Set(keys)
  return (
    batch.size < all.size && [...batch].every((key) => all.has(key)) && batch.size / all.size < SITE_PROFILE_PARTIAL_MAX
  )
}

export type SiteEvent = {
  fieldKey: string
  normalizedLabel: string
  type?: string
  outcome: "accepted" | "corrected" | "cleared"
  filled: string
  final: string
  source: "profile" | "answer" | "ai" | "site"
  /** The saved answer whose value is what the field was filled with, when there is one. */
  answerId?: string
}

/**
 * Folds one batch of events into a form's saved entries. Corrected stores the user's final value, accepted refreshes
 * it, cleared keeps the value but counts the clear (three stop the autofill) and creates nothing. A value too long to
 * fill drops the entry.
 */
export function applyEvents(
  current: SiteFieldMap,
  events: SiteEvent[],
  now: Date,
): { fieldMap: SiteFieldMap; accepted: number } {
  const fieldMap: SiteFieldMap = { ...current }
  let accepted = 0
  for (const e of events) {
    const old = fieldMap[e.fieldKey]
    if (e.outcome === "cleared") {
      if (old) {
        fieldMap[e.fieldKey] = {
          ...old,
          timesUsed: old.timesUsed + 1,
          timesCorrected: old.timesCorrected + 1,
          timesCleared: old.timesCleared + 1,
        }
      }
      continue
    }
    if (e.final.length > LEARNING_AUTOFILL_VALUE_MAX) {
      delete fieldMap[e.fieldKey]
      continue
    }
    const kind = controlKind(e.type)
    if (!kind) continue
    if (e.outcome === "accepted") accepted++
    const fromAnswer = e.outcome === "accepted" && e.source === "answer" && e.answerId
    const fromProfile = e.outcome === "accepted" && e.source === "profile"
    // Accepting what the site profile itself filled changes nothing about where the value came from.
    const same = old && e.outcome === "accepted" && e.source === "site" && old.value === e.final ? old : null
    const entry: SiteFieldEntry = {
      label: e.normalizedLabel,
      value: e.final,
      kind,
      source: same ? same.source : fromAnswer ? "answer" : fromProfile ? "profile" : "literal",
      savedAt: same ? same.savedAt : now.toISOString(),
      timesUsed: (old?.timesUsed ?? 0) + (e.outcome === "accepted" || old?.value === e.filled ? 1 : 0),
      timesCorrected: (old?.timesCorrected ?? 0) + (e.outcome === "corrected" ? 1 : 0),
      timesCleared: 0,
    }
    const answerId = same ? same.answerId : fromAnswer ? e.answerId : undefined
    if (answerId) entry.answerId = answerId
    fieldMap[e.fieldKey] = entry
  }
  return { fieldMap, accepted }
}

/** Whether a saved entry may still be offered: an entry copied from the answer bank or the profile dies with its source changing. */
export function entryIsFresh(
  entry: SiteFieldEntry,
  source: {
    answer?: { id: string; value: string; status: string }
    profileUpdatedAt?: Date | null
  },
): boolean {
  if (entry.source === "answer") {
    const { answer } = source
    return !!answer && answer.id === entry.answerId && answer.status !== "rejected" && answer.value === entry.value
  }
  if (entry.source === "profile") return !source.profileUpdatedAt || source.profileUpdatedAt <= new Date(entry.savedAt)
  return true
}

export const stopsAutofill = (entry: SiteFieldEntry) => entry.timesCleared >= CLEARED_STOP_MIN

/** Over a cap, the forms used longest ago go: first the site's own, then the user's overall. Call it inside the transaction that holds the per-user site lock. */
export async function evictLeastRecent(
  db: Pick<Db, "delete" | "select">,
  userId: string,
  siteKey: string,
  keepId: string,
): Promise<void> {
  const oldest = (scope: SQL | undefined, keep: number) =>
    db
      .select({ id: siteProfile.id })
      .from(siteProfile)
      .where(and(eq(siteProfile.userId, userId), ne(siteProfile.id, keepId), scope))
      .orderBy(desc(siteProfile.lastUsedAt), desc(siteProfile.id))
      .offset(keep - 1)
  await db
    .delete(siteProfile)
    .where(inArray(siteProfile.id, oldest(eq(siteProfile.siteKey, siteKey), SITE_PROFILES_PER_SITE_MAX)))
  await db.delete(siteProfile).where(inArray(siteProfile.id, oldest(undefined, SITE_PROFILES_PER_USER_MAX)))
}

/**
 * Every site profile write goes through here: it takes the per-user lock, which is always the last lock of a
 * transaction (answers come first), so no two writers can wait on each other.
 */
export async function withSiteLock<T>(db: Pick<Db, "execute">, userId: string, run: () => Promise<T>): Promise<T> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`sites:${userId}`}))`)
  return run()
}
