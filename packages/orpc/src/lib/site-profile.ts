import { createHash } from "node:crypto"
import { controlKind } from "@skiffr/ai"
import {
  CLEARED_STOP_MIN,
  LEARNING_AUTOFILL_VALUE_MAX,
  SITE_PROFILE_OVERLAP_MIN,
  SITE_PROFILES_PER_USER_MAX,
} from "@skiffr/common/constants"
import type { SiteFieldEntry, SiteFieldMap } from "@skiffr/common/schemas"
import { type Db, siteProfile } from "@skiffr/db"
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"

/** The distinct fingerprints of a form, sorted: the same form always gives the same list, whatever order its fields are in. */
export const formFingerprints = (fingerprints: string[]): string[] => [...new Set(fingerprints)].sort()

/** Stable hash of a form's field fingerprints. The server computes it from what it is sent, so a client can't pick one. */
export const formSignature = (fingerprints: string[]): string =>
  createHash("sha256").update(formFingerprints(fingerprints).join("\n")).digest("hex").slice(0, 32)

/** Shared fields over the larger of the two forms: adding or dropping one field of five still matches, swapping two doesn't. */
export function overlap(a: string[], b: string[]): number {
  const left = new Set(a)
  const right = new Set(b)
  const size = Math.max(left.size, right.size)
  if (size === 0) return 0
  let shared = 0
  for (const fingerprint of left) if (right.has(fingerprint)) shared++
  return shared / size
}

type Saved = { formSignature: string; fingerprints: string[]; lastUsedAt: Date }

/** The saved form for these fields: the exact one, else the most alike (at least `SITE_PROFILE_OVERLAP_MIN`), ties to the most recently used. */
export function pickSavedForm<T extends Saved>(candidates: T[], fingerprints: string[]): T | null {
  const signature = formSignature(fingerprints)
  const exact = candidates.find((row) => row.formSignature === signature)
  if (exact) return exact
  let best: { row: T; score: number } | null = null
  for (const row of candidates) {
    const score = overlap(row.fingerprints, fingerprints)
    if (score < SITE_PROFILE_OVERLAP_MIN) continue
    if (!best || score > best.score || (score === best.score && row.lastUsedAt > best.row.lastUsedAt)) {
      best = { row, score }
    }
  }
  return best?.row ?? null
}

export type SiteEvent = {
  fingerprint: string
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
export function applyEvents(current: SiteFieldMap, events: SiteEvent[]): { fieldMap: SiteFieldMap; accepted: number } {
  const fieldMap: SiteFieldMap = { ...current }
  let accepted = 0
  for (const e of events) {
    const old = fieldMap[e.fingerprint]
    if (e.outcome === "cleared") {
      if (old) {
        fieldMap[e.fingerprint] = {
          ...old,
          timesUsed: old.timesUsed + 1,
          timesCorrected: old.timesCorrected + 1,
          timesCleared: old.timesCleared + 1,
        }
      }
      continue
    }
    if (e.final.length > LEARNING_AUTOFILL_VALUE_MAX) {
      delete fieldMap[e.fingerprint]
      continue
    }
    const kind = controlKind(e.type)
    if (!kind) continue
    if (e.outcome === "accepted") accepted++
    const fromAnswer = e.outcome === "accepted" && e.source === "answer" && e.answerId
    const fromProfile = e.outcome === "accepted" && e.source === "profile"
    const entry: SiteFieldEntry = {
      label: e.normalizedLabel,
      value: e.final,
      kind,
      source: fromAnswer ? "answer" : fromProfile ? "profile" : "literal",
      timesUsed: (old?.timesUsed ?? 0) + (e.outcome === "accepted" || old?.value === e.filled ? 1 : 0),
      timesCorrected: (old?.timesCorrected ?? 0) + (e.outcome === "corrected" ? 1 : 0),
      timesCleared: 0,
    }
    if (fromAnswer) entry.answerId = e.answerId
    fieldMap[e.fingerprint] = entry
  }
  return { fieldMap, accepted }
}

/** Whether a saved entry may still be offered: an entry copied from the answer bank or the profile dies with its source changing. */
export function entryIsFresh(
  entry: SiteFieldEntry,
  source: {
    answer?: { id: string; value: string; status: string }
    profileUpdatedAt?: Date | null
    savedAt: Date
  },
): boolean {
  if (entry.source === "answer") {
    const { answer } = source
    return !!answer && answer.id === entry.answerId && answer.status !== "rejected" && answer.value === entry.value
  }
  if (entry.source === "profile") return !source.profileUpdatedAt || source.profileUpdatedAt <= source.savedAt
  return true
}

export const stopsAutofill = (entry: SiteFieldEntry) => entry.timesCleared >= CLEARED_STOP_MIN

/** Over the cap, the forms used longest ago go. Call it inside the transaction that holds the per-user site lock. */
export async function evictLeastRecent(
  db: Pick<Db, "delete" | "select">,
  userId: string,
  keepId: string,
): Promise<void> {
  await db.delete(siteProfile).where(
    inArray(
      siteProfile.id,
      db
        .select({ id: siteProfile.id })
        .from(siteProfile)
        .where(and(eq(siteProfile.userId, userId), ne(siteProfile.id, keepId)))
        .orderBy(desc(siteProfile.lastUsedAt), desc(siteProfile.id))
        .offset(SITE_PROFILES_PER_USER_MAX - 1),
    ),
  )
}

export const siteLock = (db: Pick<Db, "execute">, userId: string) =>
  db.execute(sql`select pg_advisory_xact_lock(hashtext(${`sites:${userId}`}))`)
