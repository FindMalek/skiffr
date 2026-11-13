import { createHash } from "node:crypto"
import { SENSITIVE_POLICY_VERSION } from "@skiffr/ai"
import { type SensitiveCategory, sensitiveCategorySchema } from "@skiffr/common/schemas"
import { normalizeLabel } from "@skiffr/common/utils"
import { type Db, sensitiveVerdict } from "@skiffr/db"
import { and, eq, gt, inArray, sql } from "drizzle-orm"

const TTL_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

type Question = { label?: string; options?: readonly string[] }

/** The hash a question is remembered under: what it asks and what it offers, not who asked. `null` when there is no label to judge. */
export function verdictKey({ label, options = [] }: Question): string | null {
  const text = normalizeLabel(label ?? "")
  if (!text) return null
  return createHash("sha256")
    .update([text, ...options.map(normalizeLabel).sort()].join("\n"))
    .digest("hex")
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
        gt(sensitiveVerdict.createdAt, new Date(now.getTime() - TTL_DAYS * DAY_MS)),
      ),
    )
  return new Map(rows.map((row) => [row.key, sensitiveCategorySchema.catch("other").parse(row.category)]))
}

/** Only sensitive verdicts are kept: a "not sensitive" answer saves nothing (the mapping needs the model anyway) and a page could steer it. */
export async function rememberFlagged(
  db: Db,
  now: Date,
  entries: { question: Question; category: SensitiveCategory }[],
): Promise<void> {
  const rows = new Map<string, { key: string; category: SensitiveCategory; policyVersion: number; createdAt: Date }>()
  for (const { question, category } of entries) {
    const key = verdictKey(question)
    if (key) rows.set(key, { key, category, policyVersion: SENSITIVE_POLICY_VERSION, createdAt: now })
  }
  if (rows.size === 0) return
  await db
    .insert(sensitiveVerdict)
    .values([...rows.values()])
    .onConflictDoUpdate({
      target: sensitiveVerdict.key,
      set: { category: sql`excluded.category`, policyVersion: SENSITIVE_POLICY_VERSION, createdAt: now },
    })
}
