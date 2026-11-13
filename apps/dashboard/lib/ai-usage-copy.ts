import type { AiUsage } from "@skiffr/common/schemas"
import { formatCount, formatNumber } from "@/lib/format"

export type UsageRow = {
  id: "calls" | "tokens"
  label: string
  /** "12 of 300 calls", or "143 calls" with no limit. */
  used: string
  /** "288 left", "None left", or null when there is no limit. */
  left: string | null
  /** Share used, 0 to 100, or null when there is no limit (no meter). */
  percent: number | null
  limit: number
  value: number
}

const DAY_MS = 86_400_000

function row(id: UsageRow["id"], label: string, spent: number, limit: number): UsageRow {
  const compact = id === "tokens"
  // en-US for "41.2K" and "1M": en-GB compacts to "k" and "m"
  const show = (n: number) => formatNumber(n, compact ? { compact, locale: "en-US" } : {})
  const noun = (n: number) => (compact ? `${show(n)} tokens` : formatCount(n, "call"))
  const value = Number.isFinite(spent) ? Math.max(spent, 0) : 0
  if (!(limit > 0)) return { id, label, used: noun(value), left: null, percent: null, limit: 0, value }
  const left = Math.max(limit - value, 0)
  return {
    id,
    label,
    used: `${show(value)} of ${noun(limit)}`,
    left: left === 0 ? "None left" : `${show(left)} left`,
    // floored, so 299 of 300 is not a full bar
    percent: Math.min(Math.floor((value / limit) * 100), 100),
    limit,
    value: Math.min(value, limit),
  }
}

/** One row per measure. A limit of 0 means no limit: the row has no meter and no "left". */
export function usageRows({ calls, tokens, limits }: AiUsage): UsageRow[] {
  return [row("calls", "Calls", calls, limits.calls), row("tokens", "Tokens", tokens, limits.tokens)]
}

/** The next 00:00 UTC after the usage day, or null when the day is not a date. The page shows it in the viewer's zone. */
export function resetsAt({ day }: Pick<AiUsage, "day">): Date | null {
  const start = Date.parse(`${day}T00:00:00Z`)
  return Number.isNaN(start) ? null : new Date(start + DAY_MS)
}

export const meterText = ({ used, left }: UsageRow): string => (left ? `${used}, ${left}` : used)
