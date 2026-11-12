import { SHORT_TEXT_MAX } from "@skiffr/common/constants"
import { BOARD_HOST } from "./boards"
import { canonicalizeJobUrl, unresolvedId } from "./canonical"
import { type Token, tokenize, tokenizeText } from "./html"
import type { Provider } from "./senders"
import { cleanText } from "./text"

export interface JobCandidate {
  title: string
  company: string
  location?: string
  url: string
  canonicalId: string
  /** The link was a click tracker we can't read the posting out of: the url is stored as the email had it. */
  unresolved: boolean
}

export interface EmailBody {
  html?: string
  text?: string
}

export const CANDIDATES_MAX = 40
const LINES_AFTER_TITLE = 4

/** Buttons, footers and badges that sit next to a job in an alert. */
const NOISE =
  /^(?:(?:view|see|apply|easy apply|quick apply|unsubscribe|manage|edit|update|get the app|download|help|privacy|terms|contact|new|promoted|sponsored|actively recruiting|actively hiring|be an early applicant|early applicant|\d+\+? (?:applicants?|connections?|school alumni)|posted|just posted|today|yesterday|\d+[dhwm] ago|\d+ (?:day|hour|week|month)s? ago|learn more|share|save|more|next|previous|sign in|log in|open)(?![a-z])|©|\$|£|€|from \$)/i
const BOARD_PHRASE =
  /\b(?:job alerts?|jobs? for you|jobs? you may|recommended jobs?|similar jobs?|jobs? like|see all|view all|new jobs?|more jobs?)\b/i
const ROLE =
  /\b(?:engineer|developer|programmer|manager|designer|analyst|scientist|director|lead|architect|specialist|consultant|intern(?:ship)?|administrator|coordinator|officer|recruiter|writer|editor|associate|assistant|representative|technician|accountant|advisor|strategist|researcher|producer|head of|vp|cto|ceo|devops|sre|qa|tester|marketer|sales|support|operator|agent|nurse|teacher|driver|owner|partner|executive)\b/i

const ENDS_WITH_ROLE = new RegExp(`${ROLE.source}(?:\\s*[(\\[–-].*)?$`, "i")
const isNoise = (text: string) =>
  (NOISE.test(text) && !ENDS_WITH_ROLE.test(text)) || BOARD_PHRASE.test(text) || /^[\d\s.,%+/-]+$/.test(text)
const looksLikeTitle = (text: string) =>
  text.length >= 3 && text.length <= 150 && !isNoise(text) && !/^https?:\/\//i.test(text) && !text.includes("@")

interface Hit {
  key: string
  index: number
  title: string
  url: string
  canonicalId: string | null
  unresolved: boolean
}

/** Splits `Acme · Berlin, Germany` (or ` - `, ` | `) into the company and what follows. */
function splitLine(line: string): [string, string | undefined] {
  const parts = line.split(/\s+[·•|–—-]\s+/)
  const [company, ...rest] = parts
  return [company ?? line, rest.length > 0 ? rest.join(", ") : undefined]
}

function readCards(tokens: Token[], provider: Provider): JobCandidate[] {
  const board = provider === "other" ? null : BOARD_HOST[provider]
  const hits: Hit[] = []
  const seen = new Map<string, Hit>()
  const keyAt = new Map<number, string>()

  tokens.forEach((token, index) => {
    if (token.type !== "link") return
    const canonical = canonicalizeJobUrl(token.href)
    if (!canonical) return
    let host: string
    try {
      host = new URL(canonical.url).hostname.toLowerCase()
    } catch {
      return
    }
    if (board && !board(host)) return
    if (
      canonical.kind === "job" &&
      board &&
      provider !== "ziprecruiter" &&
      !canonical.canonicalId.startsWith(`${provider}:`)
    )
      return
    const key = canonical.kind === "job" ? canonical.canonicalId : `unresolved:${token.text.toLowerCase()}`
    const titled = looksLikeTitle(token.text) && (canonical.kind === "job" && board ? true : ROLE.test(token.text))
    keyAt.set(index, key)
    const existing = seen.get(key)
    if (existing) {
      if (!existing.title && titled) Object.assign(existing, { index, title: token.text })
      return
    }
    const hit: Hit = {
      key,
      index,
      title: titled ? token.text : "",
      url: canonical.url,
      canonicalId: canonical.kind === "job" ? canonical.canonicalId : null,
      unresolved: canonical.kind === "unresolved",
    }
    seen.set(key, hit)
    hits.push(hit)
  })

  const out: JobCandidate[] = []
  for (const hit of hits) {
    if (!hit.title) continue
    const lines: string[] = []
    for (let i = hit.index + 1; i < tokens.length && lines.length < LINES_AFTER_TITLE; i++) {
      const token = tokens[i]!
      if (token.type === "link" && keyAt.has(i) && keyAt.get(i) !== hit.key) break
      if (token.text && !isNoise(token.text)) lines.push(token.text)
    }
    const [first, second] = lines
    const [company, inline] = first ? splitLine(first) : [undefined, undefined]
    const title = cleanText(hit.title)
    const named = company ? cleanText(company) : ""
    if (!named && (!board || hit.unresolved)) continue
    if (named && ROLE.test(named) && !board) continue
    const location = cleanText(inline ?? second ?? "")
    const finalCompany = named || "Unknown company"
    out.push({
      title,
      company: finalCompany,
      location: location || undefined,
      url: hit.url,
      canonicalId: hit.canonicalId ?? unresolvedId(title, finalCompany),
      unresolved: hit.unresolved,
    })
    if (out.length >= CANDIDATES_MAX) break
  }
  return out.filter((c) => c.title.length <= SHORT_TEXT_MAX)
}

/**
 * The jobs in one alert email. Layouts of the real alerts change without notice, so every board shares one reading of
 * "a link to a posting, then its company and location lines" and differs only in which links count (a LinkedIn email's
 * links must be LinkedIn ones). Anything unreadable gives no jobs and the email is left alone.
 */
export function parseEmail(provider: Provider, body: EmailBody): JobCandidate[] {
  const tokens = body.html ? tokenize(body.html) : body.text ? tokenizeText(body.text) : []
  return readCards(tokens, provider)
}
