import { STATS_DEFAULT_DAYS, STATS_MIN_SAMPLE, STATS_RANGES } from "@skiffr/common/constants"
import type { StatsOverview } from "@skiffr/common/schemas"

export type StatsDays = (typeof STATS_RANGES)[number]

/** `?days=` is anything the visitor typed, so anything but a listed range is the default. */
export function parseDays(value: string | string[] | undefined): StatsDays {
  const days = Number(Array.isArray(value) ? value[0] : value)
  return STATS_RANGES.find((range) => range === days) ?? STATS_DEFAULT_DAYS
}

/** A share, or null while the group is too small for a share to mean anything. */
export function rate(part: number, whole: number): number | null {
  return whole >= STATS_MIN_SAMPLE ? part / whole : null
}

export const percentText = (value: number | null): string => (value === null ? "n/a" : `${Math.round(value * 100)}%`)

export function hoursText(hours: number | null): string {
  if (hours === null) return "n/a"
  if (hours < 1) return "under 1 h"
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} d`
}

/** `2026-11-10` as "Nov 10", always in UTC: the stats days are UTC days. */
export const dayText = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

/** The top of a value axis: 1, 2, 5 or 10 times a power of ten, never below 1. */
export function niceMax(max: number): number {
  if (max <= 1) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  const step = [1, 2, 5, 10].find((s) => s * power >= max) ?? 10
  return step * power
}

export const matchText = (key: string): string => (key === "none" ? "No score" : key.replace("-", " to "))

export function hasActivity(stats: StatsOverview): boolean {
  return stats.jobs.queued + stats.jobs.applied + stats.jobs.skipped + stats.stages.applied + stats.autofill.fields > 0
}
