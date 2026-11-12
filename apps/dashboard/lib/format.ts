/**
 * Dates, durations and numbers for the dashboard, one place so every screen reads the same.
 *
 * Every helper is pure and total: null, undefined, NaN and invalid dates give `NA`, never a throw or "Invalid Date".
 * `locale` is a BCP 47 tag and falls back to `DEFAULT_LOCALE` when it is malformed. `timeZone` is an IANA name and
 * defaults to the runtime's zone (the viewer's in a browser). Stats days are UTC days: format them with
 * `timeZone: "UTC"`, never in the viewer's zone, so a day label matches the bucket the API counted.
 */

export const NA = "n/a"

/** Day before month and 24 hour clock, so server markup is the same on every machine. */
export const DEFAULT_LOCALE = "en-GB"

export type DateInput = Date | string | number | null | undefined

export type FormatOptions = {
  locale?: string
  timeZone?: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SKEW = 5 * MINUTE
const RELATIVE_DAYS = 7

export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function safeLocale(locale: string | undefined): string {
  if (!locale) return DEFAULT_LOCALE
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

function safeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined
  try {
    new Intl.DateTimeFormat("en", { timeZone })
    return timeZone
  } catch {
    return undefined
  }
}

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>()

function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(
  key: string,
  make: () => T,
): T {
  let found = cache.get(key) as T | undefined
  if (!found) {
    found = make()
    cache.set(key, found)
  }
  return found
}

function dateFormat(opts: FormatOptions, fields: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = safeLocale(opts.locale)
  const timeZone = safeZone(opts.timeZone)
  const make = (): Intl.DateTimeFormat =>
    // the locale's own calendar would turn ar-SA into Hijri dates, and the API counts gregorian days
    new Intl.DateTimeFormat(locale, { ...fields, timeZone, calendar: "gregory" })
  // the runtime zone can change under a cached formatter, so only a named zone is cached
  return timeZone ? cached(`d|${locale}|${timeZone}|${JSON.stringify(fields)}`, make) : make()
}

function numberFormat(opts: FormatOptions, fields: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = safeLocale(opts.locale)
  return cached(`n|${locale}|${JSON.stringify(fields)}`, () => new Intl.NumberFormat(locale, fields))
}

/** Gregorian y/m/d of an instant in a zone, as a day number, so day differences ignore DST. */
function dayNumber(date: Date, opts: FormatOptions): { day: number; year: number } {
  const parts = dateFormat(
    { ...opts, locale: "en-US" },
    {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      numberingSystem: "latn",
    },
  ).formatToParts(date)
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value)
  return { day: Date.UTC(get("year"), get("month") - 1, get("day")) / DAY, year: get("year") }
}

/** 24 hour clocks read "00:15", not "0:15"; 12 hour ones stay "3:15 PM". */
function uses24Hour(opts: FormatOptions): boolean {
  const cycle = dateFormat(opts, { hour: "numeric" }).resolvedOptions().hourCycle
  return cycle === "h23" || cycle === "h24"
}

/** "3 Nov 2026", "3 Nov 2026, 14:05" in the viewer's zone and locale. No seconds, no zone name. */
export function absoluteTime(value: DateInput, opts: FormatOptions & { time?: boolean } = {}): string {
  const date = toDate(value)
  if (!date) return NA
  const { time = true, ...rest } = opts
  const fields: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
  if (time) Object.assign(fields, { hour: uses24Hour(rest) ? "2-digit" : "numeric", minute: "2-digit" })
  const parts = dateFormat(rest, fields).formatToParts(date)
  // en and fr put a word ("at", "à") between date and clock; a comma reads the same in every locale
  const clock = parts.findIndex((part) => part.type === "hour")
  return parts
    .map((part, index) =>
      index === clock - 1 && part.type === "literal" && /^\s*\p{Script=Latin}+\s*$/u.test(part.value)
        ? ", "
        : part.value,
    )
    .join("")
}

export const absoluteDate = (value: DateInput, opts: FormatOptions = {}): string =>
  absoluteTime(value, { ...opts, time: false })

/** The date part alone, for a past date a week or more old: "3 Nov", or "3 Nov 2025" in another year. */
function shortDate(date: Date, now: Date, opts: FormatOptions): string {
  const sameYear = dayNumber(date, opts).year === dayNumber(now, opts).year
  return dateFormat(
    opts,
    sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" },
  ).format(date)
}

function relativeFormat(opts: FormatOptions): Intl.RelativeTimeFormat {
  const locale = safeLocale(opts.locale)
  // en-GB spells minutes and hours out ("2 hr ago"); every English locale gets the compact form
  const english = /^en(-|$)/.test(locale)
  return cached(
    `r|${locale}`,
    () =>
      new Intl.RelativeTimeFormat(english ? "en" : locale, { numeric: "auto", style: english ? "narrow" : "short" }),
  )
}

/**
 * "just now", "5m ago", "2h ago", "yesterday", "3d ago", then "3 Nov" and "3 Nov 2025".
 * Under a day it counts elapsed time; from a day on it counts calendar days in `timeZone`, so "yesterday" means the
 * day before and not 24 hours. A date up to 5 minutes ahead (clock skew) is "just now"; further ahead it is shown as
 * a date, never "in 2h ago".
 */
export function relativeTime(value: DateInput, now: DateInput, opts: FormatOptions = {}): string {
  const date = toDate(value)
  const clock = toDate(now)
  if (!date || !clock) return NA
  const elapsed = clock.getTime() - date.getTime()
  if (elapsed < -SKEW) return shortDate(date, clock, opts)
  const rtf = relativeFormat(opts)
  if (elapsed < MINUTE) return /^en(-|$)/.test(safeLocale(opts.locale)) ? "just now" : rtf.format(0, "second")
  if (elapsed < HOUR) return rtf.format(-Math.floor(elapsed / MINUTE), "minute")
  if (elapsed < DAY) return rtf.format(-Math.floor(elapsed / HOUR), "hour")
  const days = dayNumber(clock, opts).day - dayNumber(date, opts).day
  if (days < RELATIVE_DAYS) return rtf.format(-days, "day")
  return shortDate(date, clock, opts)
}

/** "n/a" for anything that is not a finite number. */
export function formatNumber(
  value: number | null | undefined,
  opts: FormatOptions & { compact?: boolean } = {},
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return NA
  return numberFormat(opts, opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(value)
}

/** "1 job", "3 jobs". Pass `plural` for nouns that do not take an `s`. */
export function formatCount(
  value: number | null | undefined,
  noun: string,
  plural = `${noun}s`,
  opts: FormatOptions = {},
): string {
  const text = formatNumber(value, opts)
  return text === NA ? NA : `${text} ${value === 1 ? noun : plural}`
}

/** "20 of 1,234 jobs", the count shown next to a partial list. */
export function formatOf(
  shown: number | null | undefined,
  total: number | null | undefined,
  noun: string,
  plural = `${noun}s`,
  opts: FormatOptions = {},
): string {
  const first = formatNumber(shown, opts)
  const second = formatNumber(total, opts)
  if (first === NA || second === NA) return NA
  return `${first} of ${second} ${total === 1 ? noun : plural}`
}

/** A share between 0 and 1 as "42%" (digits 0) or "42.5%". Never "-0%". */
export function formatPercent(
  ratio: number | null | undefined,
  opts: FormatOptions & { digits?: number } = {},
): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return NA
  const digits = Math.min(Math.max(Math.trunc(opts.digits ?? 0), 0), 4)
  const scale = 10 ** digits
  const rounded = Math.round(ratio * 100 * scale) / scale || 0
  return numberFormat(opts, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    rounded / 100,
  )
}

const DURATION_UNITS = [
  { unit: "day", ms: DAY },
  { unit: "hour", ms: HOUR },
  { unit: "minute", ms: MINUTE },
  { unit: "second", ms: 1000 },
] as const

/** Milliseconds as the two biggest units: "3d 4h", "2h 5m", "45s", "under 1s". Negative or non-finite is "n/a". */
export function formatDuration(ms: number | null | undefined, opts: FormatOptions = {}): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return NA
  const short = (value: number, unit: string): string =>
    numberFormat(opts, { style: "unit", unit, unitDisplay: "narrow" }).format(value)
  if (ms === 0) return short(0, "second")
  if (ms < 1000) return `under ${short(1, "second")}`
  const rounded = Math.floor(ms / 1000) * 1000
  const first = DURATION_UNITS.findIndex(({ ms: size }) => rounded >= size)
  const big = DURATION_UNITS[first]
  const small = DURATION_UNITS[first + 1]
  if (!big) return NA
  const bigCount = Math.floor(rounded / big.ms)
  const rest = small ? Math.floor((rounded % big.ms) / small.ms) : 0
  return small && rest > 0 ? `${short(bigCount, big.unit)} ${short(rest, small.unit)}` : short(bigCount, big.unit)
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const

/** 1024 based: "512 B", "1.5 KB", "3 MB". Negative or non-finite is "n/a". */
export function formatBytes(bytes: number | null | undefined, opts: FormatOptions = {}): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return NA
  const last = BYTE_UNITS.length - 1
  const round = (value: number, index: number): number =>
    index === 0 ? Math.round(value) : Math.round(value * 10) / 10
  let index = 0
  let value = bytes
  // 1023.96 KB rounds to 1024, so that moves up a unit too
  while (index < last && round(value, index) >= 1024) {
    value /= 1024
    index += 1
  }
  const text = numberFormat(opts, { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value)
  return `${text} ${BYTE_UNITS[index]}`
}
