import { SHORT_TEXT_MAX, URL_MAX } from "@skiffr/common/constants"
import { jobUrlSchema } from "@skiffr/common/schemas"
import { Parser } from "htmlparser2"
import { cleanText } from "../gmail/text"

export type Posting = { url: string; title: string; company: string }

/** Postings read from one page. More than this is a page that is not a job list. */
export const POSTINGS_MAX = 500
const MARKUP_CHARS_MAX = 2_000
const SKIPPED = new Set(["script", "style"])

function textOf(markup: string): string {
  let text = ""
  let skipped = 0
  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIPPED.has(name)) skipped++
      },
      onclosetag(name) {
        if (SKIPPED.has(name)) skipped = Math.max(0, skipped - 1)
      },
      ontext(data) {
        if (skipped === 0) text += data
      },
    },
    { decodeEntities: true },
  )
  parser.write(markup.slice(0, MARKUP_CHARS_MAX))
  parser.end()
  return text
}

/**
 * Plain text from a page or an api: markup and entities are decoded away, what is left has no angle brackets (so nothing
 * decoded can turn back into a tag), then control, direction and invisible characters go and it is cut to `max`.
 */
export function plain(input: unknown, max: number = SHORT_TEXT_MAX): string {
  if (typeof input !== "string") return ""
  const text = /[<&]/.test(input) ? textOf(input) : input
  return cleanText(text.replace(/[<>]/g, " "), max)
}

/** A link from a page, made absolute and held to the same rules as a link added by hand: http(s), no credentials, no internal host. It is stored, never opened. */
export function jobLink(raw: unknown, base: string): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > URL_MAX) return null
  let url: URL
  try {
    url = new URL(raw.trim(), base)
  } catch {
    return null
  }
  url.hash = ""
  const parsed = jobUrlSchema.safeParse(url.href)
  return parsed.success ? parsed.data : null
}

/** A posting only if it has a usable link, title and company; the company falls back to the label the user gave the source. */
export function toPosting(
  raw: { url: unknown; title: unknown; company?: unknown },
  base: string,
  fallbackCompany: string,
): Posting | null {
  const url = jobLink(raw.url, base)
  const title = plain(raw.title)
  const company = plain(raw.company) || plain(fallbackCompany)
  return url && title && company ? { url, title, company } : null
}
