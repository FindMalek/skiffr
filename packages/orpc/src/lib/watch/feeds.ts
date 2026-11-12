import { Parser } from "htmlparser2"
import { ParseError } from "./errors"
import { POSTINGS_MAX, type Posting, toPosting } from "./postings"

type Raw = { url: string; title: string }

/** A feed's text fields are small; anything longer is cut before it is kept. */
const FIELD_CHARS_MAX = 2_000

/**
 * RSS, RDF and Atom read with a streaming parser: no tree is built, entities are decoded but never expanded from a
 * DOCTYPE, and only the title and link of each item or entry are kept.
 */
export function parseXmlFeed(xml: string, base: string, label: string): Posting[] {
  const raw: Raw[] = []
  let item: { title: string; link: string; guid: string } | null = null
  let field: "title" | "link" | "guid" | null = null
  let seenFeed = false

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const tag = name.toLowerCase()
        if (tag === "rss" || tag === "feed" || tag === "rdf:rdf") seenFeed = true
        if (tag === "item" || tag === "entry") item = { title: "", link: "", guid: "" }
        else if (item && (tag === "title" || tag === "guid")) field = tag
        else if (item && tag === "link") {
          if (attributes.href !== undefined) {
            const rel = attributes.rel ?? "alternate"
            if (rel === "alternate" && !item.link) item.link = attributes.href
          } else field = "link"
        }
      },
      ontext(data) {
        if (item && field && item[field].length < FIELD_CHARS_MAX) item[field] += data
      },
      onclosetag(name) {
        const tag = name.toLowerCase()
        if (tag === "title" || tag === "link" || tag === "guid") field = null
        if ((tag === "item" || tag === "entry") && item) {
          const link = item.link.trim() || (/^https?:\/\//i.test(item.guid.trim()) ? item.guid.trim() : "")
          if (raw.length < POSTINGS_MAX) raw.push({ url: link, title: item.title })
          item = null
        }
      },
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.write(xml)
  parser.end()
  if (!seenFeed) throw new ParseError()
  return raw.flatMap((entry) => toPosting(entry, base, label) ?? [])
}

type JsonFeed = { version?: unknown; items?: unknown }

/** https://www.jsonfeed.org: `items[]` with `url` (or `external_url`) and `title`. */
export function parseJsonFeed(text: string, base: string, label: string): Posting[] {
  let feed: JsonFeed
  try {
    feed = JSON.parse(text) as JsonFeed
  } catch {
    throw new ParseError()
  }
  if (!feed || typeof feed !== "object" || !Array.isArray(feed.items)) throw new ParseError()
  return feed.items.slice(0, POSTINGS_MAX).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return []
    const item = entry as { url?: unknown; external_url?: unknown; title?: unknown }
    return toPosting({ url: item.url ?? item.external_url, title: item.title }, base, label) ?? []
  })
}
