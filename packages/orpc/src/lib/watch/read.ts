import type { WATCH_SOURCE_KINDS } from "@skiffr/common/constants"
import { type BoardKind, boardOf, parseBoard } from "./boards"
import { parseJsonFeed, parseXmlFeed } from "./feeds"
import { fetchPage, type GuardDeps } from "./guard"
import { parseHtml } from "./html"
import type { Posting } from "./postings"

type Kind = (typeof WATCH_SOURCE_KINDS)[number]

export interface SourceToRead {
  url: string
  label: string
  kind: Kind
  etag: string | null
  lastModified: string | null
}

export type Read =
  | { changed: false }
  | {
      changed: true
      kind: Exclude<Kind, "auto">
      postings: Posting[]
      etag: string | null
      lastModified: string | null
    }

const ANY =
  "application/rss+xml, application/atom+xml, application/feed+json, application/json, text/html;q=0.9, application/xml;q=0.8, */*;q=0.1"
const JSON_API = "application/json"

const XML_TYPES = /xml/
const JSON_TYPES = /json/

/** What kind of page a body is: the content type first, and the first characters when the server was vague. */
function sniff(contentType: string, body: string): "xml" | "json" | "html" {
  if (JSON_TYPES.test(contentType) && !contentType.includes("ld+json")) return "json"
  if (XML_TYPES.test(contentType)) return "xml"
  const start = body.trimStart().slice(0, 16).toLowerCase()
  if (start.startsWith("{") || start.startsWith("[")) return "json"
  if (start.startsWith("<?xml") || start.startsWith("<rss") || start.startsWith("<feed")) return "xml"
  return "html"
}

/** Fetches a source through the guard and reads its postings. A known board is read from its public json api, derived from the url the user gave. */
export async function readSource(deps: GuardDeps, source: SourceToRead): Promise<Read> {
  const board = boardOf(source.url)
  const request = {
    url: board?.api ?? source.url,
    accept: board ? JSON_API : ANY,
    etag: source.etag,
    lastModified: source.lastModified,
  }
  const page = await fetchPage(deps, request)
  if (page.status === "not_modified") return { changed: false }
  const meta = { etag: page.etag, lastModified: page.lastModified }
  if (board) {
    return {
      changed: true,
      kind: board.kind as BoardKind,
      postings: parseBoard(board.kind, page.body, page.url, source.label),
      ...meta,
    }
  }
  const type = sniff(page.contentType, page.body)
  if (type === "json")
    return { changed: true, kind: "feed", postings: parseJsonFeed(page.body, page.url, source.label), ...meta }
  if (type === "xml")
    return { changed: true, kind: "feed", postings: parseXmlFeed(page.body, page.url, source.label), ...meta }
  return { changed: true, kind: "html", postings: parseHtml(page.body, page.url, source.label), ...meta }
}
