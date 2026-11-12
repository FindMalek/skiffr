/**
 * Dates, durations and numbers for the dashboard, one place so every screen reads the same.
 *
 * Every helper is pure and total: null, undefined, NaN, invalid dates and values of the wrong type give `NA`, never a
 * throw or "Invalid Date". `locale` is a BCP 47 tag and falls back to `DEFAULT_LOCALE` when it is malformed.
 * `timeZone` is an IANA name and defaults to the runtime's zone (the viewer's in a browser); lists should pass it,
 * which is what `<Time>` does. Stats days are UTC days: format them with `timeZone: "UTC"`, never in the viewer's zone,
 * so a day label matches the bucket the API counted.
 *
 * Inputs: a number is epoch milliseconds (seconds are not guessed). A string with no zone, "2026-11-13T10:00" or
 * "2026-11-13 10:00", is read as UTC so server and browser agree. Words that are not units ("just now", "under",
 * "of", the noun and its plural) are English only.
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

const ZONELESS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/

export function toDate(value: DateInput): Date | null {
  let date: Date
  if (value instanceof Date) date = value
  else if (typeof value === "number") date = new Date(value)
  else if (typeof value === "string" && value !== "")
    date = new Date(ZONELESS.test(value) ? `${value.replace(" ", "T")}Z` : value)
  else return null
  return Number.isNaN(date.getTime()) ? null : date
}

const CACHE_LIMIT = 64

/** A Map that is emptied when it fills, so odd input (a hostile locale) cannot grow it without bound. */
function boundedMap<V>(): { get: (key: string) => V | undefined; set: (key: string, value: V) => V } {
  const map = new Map<string, V>()
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      if (map.size >= CACHE_LIMIT) map.clear()
      map.set(key, value)
      return value
    },
  }
}

const locales = boundedMap<string>()
const zones = boundedMap<string>()

function safeLocale(locale: string | undefined): string {
  if (!locale) return DEFAULT_LOCALE
  const known = locales.get(locale)
  if (known !== undefined) return known
  try {
    return locales.set(locale, Intl.getCanonicalLocales(locale)[0] ?? DEFAULT_LOCALE)
  } catch {
    return locales.set(locale, DEFAULT_LOCALE)
  }
}

/** The name is looked up once; "" marks a zone the runtime rejected. */
function safeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined
  const known = zones.get(timeZone)
  if (known !== undefined) return known || undefined
  try {
    new Intl.DateTimeFormat("en", { timeZone })
    return zones.set(timeZone, timeZone)
  } catch {
    zones.set(timeZone, "")
    return undefined
  }
}

type Formatter = Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat

const cache = boundedMap<Formatter>()

function cached<T extends Formatter>(key: string, make: () => T): T {
  return (cache.get(key) as T | undefined) ?? (cache.set(key, make()) as T)
}

/** Names the zone, so the cached formatters can be keyed by it. The runtime zone can change, so it is asked each time. */
function withZone(opts: FormatOptions): FormatOptions & { timeZone: string } {
  return { ...opts, timeZone: safeZone(opts.timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone }
}

function dateFormat(
  opts: FormatOptions & { timeZone: string },
  fields: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const locale = safeLocale(opts.locale)
  const timeZone = opts.timeZone
  return cached(
    `d|${locale}|${timeZone}|${JSON.stringify(fields)}`,
    // the locale's own calendar would turn ar-SA into Hijri dates, and the API counts gregorian days
    () => new Intl.DateTimeFormat(locale, { ...fields, timeZone, calendar: "gregory" }),
  )
}

function numberFormat(opts: FormatOptions, fields: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = safeLocale(opts.locale)
  return cached(`n|${locale}|${JSON.stringify(fields)}`, () => new Intl.NumberFormat(locale, fields))
}

/** Gregorian y/m/d of an instant in a zone, as a day number, so day differences ignore DST. */
function dayNumber(date: Date, opts: FormatOptions & { timeZone: string }): { day: number; year: number } {
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
function uses24Hour(opts: FormatOptions & { timeZone: string }): boolean {
  const cycle = dateFormat(opts, { hour: "numeric" }).resolvedOptions().hourCycle
  return cycle === "h23" || cycle === "h24"
}

/** "3 Nov 2026", "3 Nov 2026, 14:05" in the viewer's zone and locale. No seconds, no zone name. */
export function absoluteTime(value: DateInput, opts: FormatOptions & { time?: boolean } = {}): string {
  const date = toDate(value)
  if (!date) return NA
  const { time = true, ...named } = opts
  const rest = withZone(named)
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
function shortDate(date: Date, now: Date, opts: FormatOptions & { timeZone: string }): string {
  const sameYear = dayNumber(date, opts).year === dayNumber(now, opts).year
  return dateFormat(
    opts,
    sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" },
  ).format(date)
}

function relativeFormat(opts: FormatOptions): Intl.RelativeTimeFormat {
  const locale = safeLocale(opts.locale)
  // en-GB spells minutes and hours out ("2 hr ago"); every English locale gets the compact form, and keeps its
  // -u- extension so "en-u-nu-arab" has the same digits here as in absolute dates
  const english = /^en(-|$)/.test(locale)
  const tag = english ? `en${locale.match(/-u-.*$/)?.[0] ?? ""}` : locale
  return cached(
    `r|${locale}`,
    () => new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: english ? "narrow" : "short" }),
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
  if (elapsed < -SKEW) return shortDate(date, clock, withZone(opts))
  const rtf = relativeFormat(opts)
  if (elapsed < MINUTE) return /^en(-|$)/.test(safeLocale(opts.locale)) ? "just now" : rtf.format(0, "second")
  if (elapsed < HOUR) return rtf.format(-Math.floor(elapsed / MINUTE), "minute")
  if (elapsed < DAY) return rtf.format(-Math.floor(elapsed / HOUR), "hour")
  const zoned = withZone(opts)
  const days = dayNumber(clock, zoned).day - dayNumber(date, zoned).day
  if (days < RELATIVE_DAYS) return rtf.format(-days, "day")
  return shortDate(date, clock, zoned)
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

const PLURALS = new Intl.PluralRules("en")

/** The noun the displayed number takes: 1.0000001 shows as "1", so it is singular. */
const nounFor = (value: number, noun: string, plural: string): string =>
  PLURALS.select(value) === "one" ? noun : plural

/** "n/a" for anything that is not a finite number. */
export function formatNumber(
  value: number | null | undefined,
  opts: FormatOptions & { compact?: boolean } = {},
): string {
  if (!isNumber(value)) return NA
  // + 0 turns -0 into 0
  return numberFormat(opts, opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(value + 0)
}

/** "1 job", "3 jobs". Pass `plural` for nouns that do not take an `s`. English nouns only. */
export function formatCount(
  value: number | null | undefined,
  noun: string,
  plural = `${noun}s`,
  opts: FormatOptions = {},
): string {
  const text = formatNumber(value, opts)
  return text === NA || !isNumber(value) ? NA : `${text} ${nounFor(value, noun, plural)}`
}

/** "20 of 1,234 jobs", the count shown next to a partial list. English words only. */
export function formatOf(
  shown: number | null | undefined,
  total: number | null | undefined,
  noun: string,
  plural = `${noun}s`,
  opts: FormatOptions = {},
): string {
  const first = formatNumber(shown, opts)
  const second = formatNumber(total, opts)
  if (first === NA || second === NA || !isNumber(total)) return NA
  return `${first} of ${second} ${nounFor(total, noun, plural)}`
}

/** A share between 0 and 1 as "42%" (digits 0) or "42.5%". Never "-0%". */
export function formatPercent(
  ratio: number | null | undefined,
  opts: FormatOptions & { digits?: number } = {},
): string {
  if (!isNumber(ratio)) return NA
  const digits = Math.min(Math.max(Math.trunc(Number.isFinite(opts.digits) ? (opts.digits as number) : 0), 0), 4)
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
  if (!isNumber(ms) || ms < 0) return NA
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
  if (!isNumber(bytes) || bytes < 0) return NA
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
  const text = numberFormat(opts, { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value + 0)
  return `${text} ${BYTE_UNITS[index]}`
}
