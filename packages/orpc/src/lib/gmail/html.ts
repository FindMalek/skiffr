import { Parser } from "htmlparser2"
import { cleanText } from "./text"

export type Token = { type: "link"; href: string; text: string } | { type: "text"; text: string }

export const HTML_CHARS_MAX = 1_500_000
const TOKENS_MAX = 4_000
const SKIPPED = new Set(["script", "style", "title", "noscript", "template"])
const BLOCK = new Set([
  "p",
  "div",
  "td",
  "th",
  "tr",
  "table",
  "li",
  "ul",
  "ol",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "article",
  "header",
  "footer",
  "center",
  "blockquote",
])

/**
 * An email's HTML as a flat list of links and text blocks in reading order. It is read with a streaming parser: no tree
 * is built (so deep nesting costs nothing), nothing is rendered or executed, and only text survives, cleaned of
 * control and direction characters. Scripts and styles are dropped.
 */
export function tokenize(html: string): Token[] {
  const tokens: Token[] = []
  const push = (token: Token) => {
    if (tokens.length < TOKENS_MAX) tokens.push(token)
  }
  let skipped = 0
  let anchor: { href: string; text: string[] } | null = null
  let block: string[] = []

  const flush = () => {
    const text = cleanText(block.join(" "), 300)
    block = []
    if (text) push({ type: "text", text })
  }
  const closeAnchor = () => {
    if (!anchor) return
    push({ type: "link", href: anchor.href, text: cleanText(anchor.text.join(" "), 300) })
    anchor = null
  }

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (SKIPPED.has(name)) {
          skipped++
          return
        }
        if (skipped) return
        if (name === "a") {
          closeAnchor()
          flush()
          anchor = { href: attributes.href ?? "", text: [] }
        } else if (BLOCK.has(name)) {
          if (anchor) anchor.text.push(" ")
          else flush()
        }
      },
      ontext(data) {
        if (skipped) return
        ;(anchor ? anchor.text : block).push(data)
      },
      onclosetag(name) {
        if (SKIPPED.has(name)) {
          skipped = Math.max(0, skipped - 1)
          return
        }
        if (skipped) return
        if (name === "a") closeAnchor()
        else if (BLOCK.has(name) && !anchor) flush()
      },
      onend() {
        closeAnchor()
        flush()
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  )
  parser.write(html.slice(0, HTML_CHARS_MAX))
  parser.end()
  return tokens
}

const BARE_URL = /^https?:\/\/\S+$/i

/** A plain text part: a line that is only a url is the link of the line above it. */
export function tokenizeText(text: string): Token[] {
  const tokens: Token[] = []
  let previous = ""
  for (const raw of text.slice(0, HTML_CHARS_MAX).split(/\r?\n/)) {
    const line = cleanText(raw, 2_048)
    if (!line) continue
    if (BARE_URL.test(line)) {
      tokens.push({ type: "link", href: line, text: cleanText(previous, 300) })
      previous = ""
    } else {
      if (previous) tokens.push({ type: "text", text: cleanText(previous, 300) })
      previous = line
    }
    if (tokens.length >= TOKENS_MAX) break
  }
  if (previous) tokens.push({ type: "text", text: cleanText(previous, 300) })
  return tokens
}
