import { canonicalizeJob } from "@skiffr/common/utils"
import { Parser } from "htmlparser2"
import { HTML_CHARS_MAX, tokenize } from "../gmail/html"
import { POSTINGS_MAX, type Posting, plain, toPosting } from "./postings"

const LD_SCRIPTS_MAX = 20
const LD_CHARS_MAX = 300_000
const LD_NODES_MAX = 5_000
const LD_DEPTH_MAX = 6

const JOB_PATH =
  /\/(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|postings?|roles?|opportunit(?:y|ies))\/[^/]+/i
const JOB_PARAM = /^(?:gh_jid|jid|job_?id|jobid|posting_?id|req_?id|requisition_?id)$/i
const NOT_A_TITLE =
  /^(?:apply(?: now| here| today)?|view(?: all)?(?: jobs| openings| roles| positions)?|see (?:all|more).*|learn more|read more|more|back|home|careers?|jobs?|join us|join our team|open (?:positions|roles)|all (?:jobs|positions|roles)|search jobs?|sign in|log in|menu|skip to .*)$/i

/** The `application/ld+json` scripts of a page, each cut short, so a hostile page can't make this read more than a fixed amount. */
function ldScripts(html: string): string[] {
  const found: string[] = []
  let current: string[] | null = null
  let size = 0
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "script" && /ld\+json/i.test(attributes.type ?? "") && found.length < LD_SCRIPTS_MAX) {
          current = []
          size = 0
        }
      },
      ontext(data) {
        if (current && size < LD_CHARS_MAX) {
          current.push(data)
          size += data.length
        }
      },
      onclosetag(name) {
        if (name === "script" && current) {
          found.push(current.join(""))
          current = null
        }
      },
    },
    { decodeEntities: false },
  )
  parser.write(html.slice(0, HTML_CHARS_MAX))
  parser.end()
  return found
}

const typeIs = (node: Record<string, unknown>, wanted: string) => {
  const type = node["@type"]
  return type === wanted || (Array.isArray(type) && type.includes(wanted))
}

function collect(root: unknown, out: Array<Record<string, unknown>>) {
  let visited = 0
  const walk = (node: unknown, depth: number) => {
    if (visited++ > LD_NODES_MAX || depth > LD_DEPTH_MAX || out.length >= POSTINGS_MAX) return
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1)
      return
    }
    if (!node || typeof node !== "object") return
    const object = node as Record<string, unknown>
    if (typeIs(object, "JobPosting")) {
      out.push(object)
      return
    }
    for (const key of ["@graph", "itemListElement", "item", "mainEntity"]) walk(object[key], depth + 1)
  }
  walk(root, 0)
}

const organization = (value: unknown): unknown =>
  value && typeof value === "object" ? (value as { name?: unknown }).name : value

/** schema.org `JobPosting` objects in the page's JSON-LD: the most reliable thing a careers page can carry. */
function jsonLdPostings(html: string, base: string, label: string): Posting[] {
  const nodes: Array<Record<string, unknown>> = []
  for (const script of ldScripts(html)) {
    try {
      collect(JSON.parse(script), nodes)
    } catch {}
  }
  return nodes.flatMap((node) => {
    const posting = toPosting(
      { url: node.url ?? node.sameAs, title: node.title ?? node.name, company: organization(node.hiringOrganization) },
      base,
      label,
    )
    return posting ? [posting] : []
  })
}

/** A link that reads as one posting: on the page's own host or a known board, with a job-like path, and a title that is not navigation. */
function looksLikePosting(href: URL, text: string, page: URL): boolean {
  if (text.length < 4 || text.length > 120 || NOT_A_TITLE.test(text)) return false
  const bare = (host: string) => host.replace(/^www\./, "")
  if (bare(href.hostname) !== bare(page.hostname) && !canonicalizeJob(href.href).vendor) return false
  if (href.pathname === page.pathname && href.search === page.search) return false
  if (canonicalizeJob(href.href).vendor) return true
  if (JOB_PATH.test(href.pathname)) return true
  return (
    [...href.searchParams.keys()].some((key) => JOB_PARAM.test(key)) &&
    /job|career|position|opening/i.test(href.pathname)
  )
}

function anchorPostings(html: string, base: string, label: string): Posting[] {
  const page = new URL(base)
  const seen = new Set<string>()
  const postings: Posting[] = []
  for (const token of tokenize(html)) {
    if (token.type !== "link" || postings.length >= POSTINGS_MAX) continue
    let href: URL
    try {
      href = new URL(token.href.trim(), page)
    } catch {
      continue
    }
    href.hash = ""
    if (!/^https?:$/.test(href.protocol) || seen.has(href.href)) continue
    const title = plain(token.text)
    if (!looksLikePosting(href, title, page)) continue
    const posting = toPosting({ url: href.href, title }, base, label)
    if (!posting) continue
    seen.add(href.href)
    postings.push(posting)
  }
  return postings
}

/** JSON-LD job postings when the page has them, otherwise the links that look like one. Both are bounded in what they read. */
export function parseHtml(html: string, base: string, label: string): Posting[] {
  const structured = jsonLdPostings(html, base, label)
  return structured.length > 0 ? structured : anchorPostings(html, base, label)
}
