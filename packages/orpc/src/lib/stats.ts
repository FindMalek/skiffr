import { MATCH_BUCKETS } from "@skiffr/common/constants"

const DAY_MS = 86_400_000

/** Every stats boundary is a UTC calendar day, so the same applications land on the same day for every viewer. */
export const dayKey = (date: Date): string => date.toISOString().slice(0, 10)

const dayStart = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

/** Midnight UTC of the first day of a range of `days` days that ends today. */
export const rangeStart = (now: Date, days: number): Date => new Date(dayStart(now).getTime() - (days - 1) * DAY_MS)

/** Every day from `from` to `now`, a missing day counting zero. */
export function fillDays(from: Date, now: Date, counts: ReadonlyMap<string, number>) {
  const out: { day: string; count: number }[] = []
  for (let at = from.getTime(); at <= now.getTime(); at += DAY_MS) {
    const day = dayKey(new Date(at))
    out.push({ day, count: counts.get(day) ?? 0 })
  }
  return out
}

/** The Monday (UTC) of the week a `YYYY-MM-DD` day is in. */
export function weekOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  const sinceMonday = (date.getUTCDay() + 6) % 7
  return dayKey(new Date(date.getTime() - sinceMonday * DAY_MS))
}

export function groupWeeks(perDay: readonly { day: string; count: number }[]) {
  const weeks = new Map<string, number>()
  for (const { day, count } of perDay) weeks.set(weekOf(day), (weeks.get(weekOf(day)) ?? 0) + count)
  return [...weeks].map(([week, count]) => ({ week, count }))
}

export const matchBucket = (score: number | null): string =>
  score === null ? "none" : (MATCH_BUCKETS.find((bucket) => score <= bucket.max)?.key ?? "none")

export const TIME_BUCKETS = ["under 1 day", "1 to 3 days", "3 to 7 days", "over 7 days"] as const
