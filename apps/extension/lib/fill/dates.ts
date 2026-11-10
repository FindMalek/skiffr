export type DateParts = { y?: number; m?: number; d?: number; h?: number; min?: number }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const pad = (n: number, size = 2) => String(n).padStart(size, "0")

export function isDayFirst(locale: string | undefined): boolean {
  try {
    const parts = new Intl.DateTimeFormat(locale || "en-US").formatToParts(new Date(2000, 10, 25))
    const order = parts.map((part) => part.type)
    return order.indexOf("day") < order.indexOf("month")
  } catch {
    return false
  }
}

function fullYear(y: number): number {
  return y >= 100 ? y : y + (y > 50 ? 1900 : 2000)
}

function valid({ y, m, d }: DateParts): boolean {
  return (m === undefined || (m >= 1 && m <= 12)) && (d === undefined || (d >= 1 && d <= 31)) && y !== undefined
}

export const AMBIGUOUS = "ambiguous" as const

/** Null when the text is not a date, `AMBIGUOUS` when 03/04/2025 could be either order and no locale was given. */
export function parseDate(input: string, locale?: string): DateParts | typeof AMBIGUOUS | null {
  const text = input.trim()
  let hit = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T\s]+(\d{1,2}):(\d{2}))?/.exec(text)
  if (hit) {
    const parts = {
      y: +hit[1]!,
      m: +hit[2]!,
      d: hit[3] ? +hit[3] : undefined,
      h: hit[4] ? +hit[4] : undefined,
      min: hit[5] ? +hit[5] : undefined,
    }
    return valid(parts) ? parts : null
  }
  hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text)
  if (hit) {
    const [a, b, y] = [+hit[1]!, +hit[2]!, fullYear(+hit[3]!)]
    const dayFirst = a > 12 ? true : b > 12 || a === b ? false : locale ? isDayFirst(locale) : null
    if (dayFirst === null) return AMBIGUOUS
    const parts = dayFirst ? { y, m: b, d: a } : { y, m: a, d: b }
    return valid(parts) ? parts : null
  }
  hit = /^(\d{1,2})[/.-](\d{4})$/.exec(text)
  if (hit) return valid({ y: +hit[2]!, m: +hit[1]! }) ? { y: +hit[2]!, m: +hit[1]! } : null
  const month = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1
  hit = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(text)
  if (hit && month(hit[1]!) > 0) return { y: +hit[3]!, m: month(hit[1]!), d: +hit[2]! }
  hit = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(text)
  if (hit && month(hit[2]!) > 0) return { y: +hit[3]!, m: month(hit[2]!), d: +hit[1]! }
  hit = /^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(text)
  if (hit && month(hit[1]!) > 0) return { y: +hit[2]!, m: month(hit[1]!) }
  return null
}

export function parseTime(input: string): { h: number; min: number } | null {
  const hit = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(input.trim())
  if (!hit) return null
  let h = +hit[1]!
  const meridiem = hit[3]?.toLowerCase()
  if (meridiem === "pm" && h < 12) h += 12
  if (meridiem === "am" && h === 12) h = 0
  return h <= 23 ? { h, min: hit[2] ? +hit[2] : 0 } : null
}

/** Value string a native date-like input accepts, null when the text is not a date, `AMBIGUOUS` when its order is unknown. */
export function toNativeDate(type: string, text: string, locale?: string): string | typeof AMBIGUOUS | null {
  if (type === "time") {
    const time = parseTime(text) ?? parseDate(text, locale)
    if (time === AMBIGUOUS) return AMBIGUOUS
    return time && time.h !== undefined && time.min !== undefined ? `${pad(time.h)}:${pad(time.min)}` : null
  }
  const parts = parseDate(text, locale)
  if (parts === AMBIGUOUS) return AMBIGUOUS
  if (!parts || parts.y === undefined || parts.m === undefined) return null
  const month = `${pad(parts.y, 4)}-${pad(parts.m)}`
  if (type === "month") return month
  if (parts.d === undefined) return null
  const day = `${month}-${pad(parts.d)}`
  if (type === "date") return day
  if (type === "datetime-local") return `${day}T${pad(parts.h ?? 0)}:${pad(parts.min ?? 0)}`
  return null
}

const TOKENS = /yyyy|yy|mm|dd/gi
const PATTERN = /(?:yyyy|yy|mm|dd)(?:[^a-z0-9]+(?:yyyy|yy|mm|dd))+/i

/** Reformats a date for a text input whose placeholder spells out a pattern like DD/MM/YYYY. */
export function toHintedDate(text: string, hint: string, locale?: string): string | typeof AMBIGUOUS | null {
  if (/h{1,2}:/i.test(hint)) return null
  const pattern = PATTERN.exec(hint)?.[0]
  if (!pattern) return null
  const parts = parseDate(text, locale)
  if (parts === AMBIGUOUS) return AMBIGUOUS
  if (!parts || parts.y === undefined) return null
  let missing = false
  const out = pattern.replace(TOKENS, (token) => {
    const kind = token.toLowerCase()
    const value = kind === "mm" ? parts.m : kind === "dd" ? parts.d : parts.y
    if (value === undefined) {
      missing = true
      return token
    }
    return kind === "yyyy" ? pad(value, 4) : pad(kind === "yy" ? value % 100 : value)
  })
  return missing ? null : out
}
