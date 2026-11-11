import { httpUrlSchema } from "../schemas/url"

/** Invisible or direction-changing characters a title can use to disguise text: format and control characters, line separators and blank-looking fillers. */
const HIDDEN = /[\p{Cf}\p{Cc}\u2028\u2029\u115f\u1160\u2800\u3164\uffa0]/gu
const SPACE = /[\t\n\r\f\v\u0085]+/g

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

const hex = (char: string) => `[U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}]`

/**
 * Text from an email or web page, safe to show: bidi, zero-width and control characters become `[U+XXXX]` so they
 * can't reorder or hide text, line breaks become spaces, and a zero-width joiner stays only inside an emoji sequence.
 */
export function neutralizeText(text: string): string {
  const joined = text.replace(LONE_SURROGATE, "\ufffd").replace(SPACE, " ")
  return joined.replace(HIDDEN, (char: string, offset: number) => {
    if (char === "\u200d" && /(?:\p{Extended_Pictographic}|\ufe0f)$/u.test(joined.slice(0, offset))) return char
    return hex(char)
  })
}

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** At most `max` user-perceived characters (never half an emoji or an accented letter), with an ellipsis when cut. */
export function clipGraphemes(text: string, max: number): string {
  if (text.length <= max) return text
  const window = text.slice(0, max * 16)
  let count = 0
  let end = 0
  for (const { segment } of SEGMENTER.segment(window)) {
    if (count === max) return `${window.slice(0, end)}…`
    count++
    end += segment.length
  }
  return window.length < text.length ? `${window.slice(0, end)}…` : window
}

export function displayText(text: string, max: number): string {
  return clipGraphemes(neutralizeText(text), max)
}

/** The url only if it is a plain http(s) link with no credentials: the one kind that may become an `href`. */
export function safeHref(url: string): string | null {
  if (!httpUrlSchema.safeParse(url).success) return null
  try {
    const parsed = new URL(url.trim())
    if (parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

/** The host the link really goes to (punycode for lookalike letters), for phishing awareness. */
export function linkHost(url: string): string | null {
  const href = safeHref(url)
  return href ? new URL(href).host.replace(/^www\./, "") : null
}
