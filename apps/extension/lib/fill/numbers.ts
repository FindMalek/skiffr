const CURRENCY = /[$€£¥₹]|^[A-Za-z]{3}(?=\s*\d)|(?<=\d)\s*[A-Za-z]{3}$/g

export type NumberResult = { value: string } | { error: string }

const AMBIGUOUS: NumberResult = { error: "ambiguous number: group and decimal separators are unknown" }

/**
 * Turns text into the plain `1234.5` form a number input takes. Without a locale only text that has one reading is
 * accepted: no separator, or a single separator that is not followed by exactly three digits.
 */
export function parseNumber(text: string, locale?: string): NumberResult {
  const cleaned = text.replace(/[\s  ']/g, "").replace(CURRENCY, "")
  if (!/^[+-]?[\d.,]+$/.test(cleaned)) return { error: "value is not a number" }
  const sign = cleaned.startsWith("-") ? "-" : ""
  const digits = cleaned.replace(/^[+-]/, "")

  let plain: string
  if (locale) {
    let parts: Intl.NumberFormatPart[]
    try {
      parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
    } catch {
      return { error: "unknown locale" }
    }
    const group = parts.find((part) => part.type === "group")?.value.replace(/[\s  ]/g, "")
    const decimal = parts.find((part) => part.type === "decimal")?.value ?? "."
    plain = (group ? digits.split(group).join("") : digits).replace(decimal, ".")
  } else {
    const hasDot = digits.includes(".")
    const hasComma = digits.includes(",")
    if (hasDot && hasComma) return AMBIGUOUS
    const separator = hasDot ? "." : hasComma ? "," : ""
    if (separator) {
      const pieces = digits.split(separator)
      if (pieces.length > 2 || pieces[1]?.length === 3) return AMBIGUOUS
    }
    plain = digits.replace(",", ".")
  }
  return /^\d+(\.\d+)?$/.test(plain) ? { value: `${sign}${plain}` } : { error: "value is not a number" }
}
