import { createHash } from "node:crypto"
import { controlKind, SENSITIVE_POLICY_VERSION } from "@skiffr/ai"
import {
  SENSITIVE_VERDICT_PRUNE_BATCH,
  SENSITIVE_VERDICT_TTL_DAYS,
  SENSITIVE_VERDICTS_PER_CALL_MAX,
  SENSITIVE_VERDICTS_PER_USER_DAY_MAX,
} from "@skiffr/common/constants"
import { type SensitiveCategory, sensitiveCategorySchema } from "@skiffr/common/schemas"
import { normalizeLabel } from "@skiffr/common/utils"
import { aiUsage, type Db, sensitiveVerdict } from "@skiffr/db"
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm"
import { utcDay } from "./ai-usage"

const DAY_MS = 24 * 60 * 60 * 1000

type Question = { label?: string; options?: readonly string[] }

/** A field with the texts a page puts next to its label: only the label and the options are part of what a verdict is stored under. */
type Descriptor = Question & { name?: string; ariaLabel?: string; placeholder?: string; type?: string }

/**
 * The hash a question is remembered under: what it asks and what it offers, not who asked, hashed (not anonymous: a
 * dictionary of common questions can be hashed too). `null` when there is no label to judge.
 */
export function verdictKey({ label, options = [] }: Question): string | null {
  const text = normalizeLabel(label ?? "")
  if (!text) return null
  return createHash("sha256")
    .update([text, ...options.map(normalizeLabel).sort()].join("\n"))
    .digest("hex")
}

/**
 * Whether a verdict the model gave for this descriptor may be remembered for everyone. The model reads the name, the aria
 * label and the placeholder too, and a page controls all three, so a verdict that could have come from them is not stored
 * under the label: a hostile page could otherwise get an ordinary question blocked for every user. Only descriptors whose
 * extra texts are empty or repeat the label are remembered, and a type that is not a known control is page text too. The
 * model never sees the field id (it gets its own) or a type that is not a known control, see `mapFields`.
 */
export function isRememberable(field: Descriptor): boolean {
  const label = normalizeLabel(field.label ?? "")
  if (!label) return false
  if (field.type !== undefined && field.type.trim() !== "" && controlKind(field.type) === null) return false
  return [field.name, field.ariaLabel, field.placeholder].every((text) => {
    const own = normalizeLabel(text ?? "")
    return own === "" || own === label
  })
}

/** The hashes among these questions that the model has already called sensitive, under the current policy and not expired, with its category. */
export async function flaggedKeys(db: Db, now: Date, questions: Question[]): Promise<Map<string, SensitiveCategory>> {
  const keys = [...new Set(questions.map(verdictKey).filter((key): key is string => key !== null))]
  if (keys.length === 0) return new Map()
  const rows = await db
    .select({ key: sensitiveVerdict.key, category: sensitiveVerdict.category })
    .from(sensitiveVerdict)
    .where(
      and(
        inArray(sensitiveVerdict.key, keys),
        eq(sensitiveVerdict.policyVersion, SENSITIVE_POLICY_VERSION),
        gt(sensitiveVerdict.createdAt, new Date(now.getTime() - SENSITIVE_VERDICT_TTL_DAYS * DAY_MS)),
      ),
    )
  return new Map(rows.map((row) => [row.key, sensitiveCategorySchema.catch("other").parse(row.category)]))
}

/** Takes `count` of the user's rows for the day in one statement, so parallel calls can't pass the cap together. */
async function reserveRows(db: Db, userId: string, day: string, count: number): Promise<boolean> {
  const rows = await db
    .insert(aiUsage)
    .values({ userId, day, verdicts: count })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day],
      set: { verdicts: sql`${aiUsage.verdicts} + ${count}` },
      setWhere: sql`${aiUsage.verdicts} + ${count} <= ${SENSITIVE_VERDICTS_PER_USER_DAY_MAX}`,
    })
    .returning({ verdicts: aiUsage.verdicts })
  return rows.length > 0
}

const PRUNE_EVERY_MS = 60 * 60 * 1000
let lastPrune = Number.NEGATIVE_INFINITY

/** For tests: forget when the last prune ran. */
export function resetVerdictPrune(): void {
  lastPrune = Number.NEGATIVE_INFINITY
}

/** Rows past the expiry are only ignored when read, so some are deleted when a row is written, at most once an hour per process (`created_at` has no index). */
async function pruneExpired(db: Db, now: Date): Promise<void> {
  if (Math.abs(now.getTime() - lastPrune) < PRUNE_EVERY_MS) return
  lastPrune = now.getTime()
  const expired = new Date(now.getTime() - SENSITIVE_VERDICT_TTL_DAYS * DAY_MS)
  await db
    .delete(sensitiveVerdict)
    .where(
      inArray(
        sensitiveVerdict.key,
        db
          .select({ key: sensitiveVerdict.key })
          .from(sensitiveVerdict)
          .where(lt(sensitiveVerdict.createdAt, expired))
          .limit(SENSITIVE_VERDICT_PRUNE_BATCH),
      ),
    )
}

/**
 * Only sensitive verdicts are kept: a "not sensitive" answer saves nothing (the mapping needs the model anyway) and a page
 * could steer it. At most `SENSITIVE_VERDICTS_PER_CALL_MAX` rows per call and `SENSITIVE_VERDICTS_PER_USER_DAY_MAX` per user
 * and day; a call over the user's cap writes none. Fields that are not `isRememberable` are never stored.
 */
export async function rememberFlagged(
  db: Db,
  now: Date,
  userId: string,
  entries: { field: Descriptor; category: SensitiveCategory }[],
): Promise<void> {
  const rows = new Map<string, { key: string; category: SensitiveCategory; policyVersion: number; createdAt: Date }>()
  for (const { field, category } of entries) {
    const key = isRememberable(field) ? verdictKey(field) : null
    if (key && rows.size < SENSITIVE_VERDICTS_PER_CALL_MAX) {
      rows.set(key, { key, category, policyVersion: SENSITIVE_POLICY_VERSION, createdAt: now })
    }
  }
  if (rows.size === 0 || !(await reserveRows(db, userId, utcDay(now), rows.size))) return
  await pruneExpired(db, now)
  await db
    .insert(sensitiveVerdict)
    .values([...rows.values()])
    .onConflictDoUpdate({
      target: sensitiveVerdict.key,
      set: { category: sql`excluded.category`, policyVersion: SENSITIVE_POLICY_VERSION, createdAt: now },
    })
}
