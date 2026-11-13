import type { AnswerOrigin, AnswerProvenance } from "@skiffr/common/schemas"
import { displayText } from "@skiffr/common/utils"
import { answer, type Db, fieldEvent } from "@skiffr/db"
import { and, asc, eq, inArray, min, ne, sql } from "drizzle-orm"

const SITES_SHOWN = 3
const SITE_TEXT_MAX = 120

const n = (expr: ReturnType<typeof sql>) => sql<number>`${expr}::int`

/** `autofill` rows are corrections the user made; a user's confirmation turns one into `confirmed`. */
export function originOf(
  source: "manual" | "autofill" | "ai" | "import",
  status: "learned" | "confirmed" | "rejected",
): AnswerOrigin {
  if (source === "manual") return "manual"
  if (source === "import") return "imported"
  if (source === "ai") return "ai"
  return status === "confirmed" ? "confirmed" : "learned"
}

type SiteRow = { label: string; site: string; forms: number; first: Date; used: Date | null }

/**
 * Provenance for one page of the user's answers (same order as `answers.list`). Three statements however many answers
 * the page holds: the page, the recorded fields grouped by question and site, and the fields the user typed over an
 * answer grouped by question. `filled_value` is never read and `final_value` is only counted, never returned.
 */
export async function answerProvenance(
  db: Db,
  userId: string,
  page: { limit: number; offset: number },
): Promise<AnswerProvenance[]> {
  const rows = await db
    .select({
      id: answer.id,
      label: answer.normalizedLabel,
      source: answer.source,
      status: answer.status,
      timesUsed: answer.timesUsed,
      timesCorrected: answer.timesCorrected,
      timesCleared: answer.timesCleared,
    })
    .from(answer)
    .where(eq(answer.userId, userId))
    .orderBy(asc(answer.normalizedLabel), asc(answer.id))
    .limit(page.limit)
    .offset(page.offset)
  if (rows.length === 0) return []

  const labels = rows.map((row) => row.label)
  const mine = and(eq(fieldEvent.userId, userId), inArray(fieldEvent.normalizedLabel, labels))
  const [siteRows, conflictRows] = await Promise.all([
    db
      .select({
        label: fieldEvent.normalizedLabel,
        site: fieldEvent.siteKey,
        forms: n(sql`count(distinct ${fieldEvent.createdAt})`),
        first: min(fieldEvent.createdAt).mapWith(fieldEvent.createdAt),
        used: sql<Date | null>`max(${fieldEvent.createdAt}) filter (where ${fieldEvent.source} = 'answer')`.mapWith(
          fieldEvent.createdAt,
        ),
      })
      .from(fieldEvent)
      .where(mine)
      .groupBy(fieldEvent.normalizedLabel, fieldEvent.siteKey),
    db
      .select({
        label: fieldEvent.normalizedLabel,
        values: n(sql`count(distinct ${fieldEvent.finalValue})`),
        sites: sql<string[]>`(array_agg(distinct ${fieldEvent.siteKey}))[1:${sql.raw(String(SITES_SHOWN))}]`,
        lastAt: sql<Date>`max(${fieldEvent.createdAt})`.mapWith(fieldEvent.createdAt),
      })
      .from(fieldEvent)
      .innerJoin(
        answer,
        and(eq(answer.userId, fieldEvent.userId), eq(answer.normalizedLabel, fieldEvent.normalizedLabel)),
      )
      .where(and(mine, eq(fieldEvent.outcome, "corrected"), ne(fieldEvent.finalValue, answer.value)))
      .groupBy(fieldEvent.normalizedLabel),
  ])

  const sitesOf = new Map<string, SiteRow[]>()
  for (const row of siteRows as SiteRow[]) sitesOf.set(row.label, [...(sitesOf.get(row.label) ?? []), row])
  const conflictOf = new Map(conflictRows.map((row) => [row.label, row]))
  const text = (site: string) => displayText(site, SITE_TEXT_MAX)

  return rows.map((row) => {
    const sites = (sitesOf.get(row.label) ?? []).sort(
      (a, b) => b.forms - a.forms || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0),
    )
    const earliest = sites.reduce<SiteRow | null>((best, s) => (!best || s.first < best.first ? s : best), null)
    const used = sites.reduce<Date | null>((best, s) => (s.used && (!best || s.used > best) ? s.used : best), null)
    const conflict = conflictOf.get(row.label)
    return {
      id: row.id,
      origin: originOf(row.source, row.status),
      forms: sites.reduce((sum, s) => sum + s.forms, 0),
      siteCount: sites.length,
      sites: sites.slice(0, SITES_SHOWN).map((s) => ({ site: text(s.site), forms: s.forms })),
      firstSeenAt: earliest?.first ?? null,
      firstSeenSite: earliest ? text(earliest.site) : null,
      lastUsedAt: used,
      timesUsed: row.timesUsed,
      timesCorrected: row.timesCorrected,
      timesCleared: row.timesCleared,
      conflict: conflict ? { values: conflict.values, sites: conflict.sites.map(text), lastAt: conflict.lastAt } : null,
    }
  })
}
