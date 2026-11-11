import { SHORT_TEXT_MAX, URL_MAX } from "@skiffr/common/constants"
import { canonicalizeJob, isBoardHost } from "@skiffr/common/utils"
import { sha256 } from "./crypto"

export type CanonicalUrl =
  | { kind: "job"; url: string; canonicalId: string }
  /** A click tracker we can't read the posting out of. It is kept as the email had it, and never fetched to find out. */
  | { kind: "unresolved"; url: string }

const RAW_URL_MAX = 4_096
const REDIRECT_PARAMS = [
  "url",
  "u",
  "redirect",
  "redirect_url",
  "redirecturl",
  "target",
  "dest",
  "destination",
  "link",
  "to",
]
const TRACKER_HOST =
  /^(?:click|clicks|links?|track|tracking|trk|email|e|em\d*|mail|mailer|go|r|t|u|url|redirect|ct|cts|clk|lnk|mandrillapp|sendgrid|list-manage|hubspotlinks|customeriomail)\.|(?:^|\.)(?:sendgrid\.net|list-manage\.com|mandrillapp\.com|mailchimp\.com|bit\.ly|lnkd\.in|t\.co|ow\.ly|tinyurl\.com|rs6\.net|exct\.net|sparkpostmail\d*\.com|customeriomail\.com|hubspotlinks\.com)$/
const TRACKER_PATH = /^\/(?:ls\/click|redirect|track|click|clk|e\/c\/|r\/|u\/|rc\/clk\/dl|pagead\/clk)/i

function parse(raw: string): URL | null {
  if (raw.length > RAW_URL_MAX) return null
  try {
    const url = new URL(raw.trim())
    return url.protocol === "https:" || url.protocol === "http:" ? url : null
  } catch {
    return null
  }
}

function embeddedTarget(url: URL): URL | null {
  for (const name of REDIRECT_PARAMS) {
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() !== name) continue
      const target = parse(value)
      if (target) return target
    }
  }
  return null
}

const looksLikeTracker = (url: URL) => TRACKER_HOST.test(url.hostname) || TRACKER_PATH.test(url.pathname)

function job(url: string, canonicalId: string): CanonicalUrl | null {
  return url.length <= URL_MAX && canonicalId.length <= SHORT_TEXT_MAX ? { kind: "job", url, canonicalId } : null
}

const BOARDS = ["linkedin", "indeed", "glassdoor"] as const

/**
 * The posting a link points at, read from the url alone: nothing is fetched and no redirect is followed, since an email's
 * links are attacker-chosen and tracked. The id and the stored link come from the shared `canonicalizeJob` (vendor links
 * reduce to the vendor's clean link). Here only the email's own click trackers are unwrapped, down to the link they carry.
 */
export function canonicalizeJobUrl(raw: string, depth = 0): CanonicalUrl | null {
  const url = parse(raw)
  if (!url) return null
  url.username = ""
  url.password = ""
  const shared = canonicalizeJob(url.href)
  if (shared.vendor) return job(shared.url, shared.canonicalId)
  if (depth < 2) {
    const target = embeddedTarget(url)
    if (target) return canonicalizeJobUrl(target.href, depth + 1)
  }
  if (looksLikeTracker(url) || BOARDS.some((board) => isBoardHost(board, url.hostname))) {
    url.hash = ""
    return url.href.length <= URL_MAX ? { kind: "unresolved", url: url.href } : null
  }
  return job(shared.url, shared.canonicalId)
}

/** The id for a posting that only has a click tracker, so a repeat of it (same title and company) still dedupes. */
export const unresolvedId = (title: string, company: string): string =>
  `redirect:${sha256(`${title.toLowerCase()}|${company.toLowerCase()}`).slice(0, 32)}`
