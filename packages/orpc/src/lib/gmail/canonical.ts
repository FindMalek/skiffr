import { SHORT_TEXT_MAX, URL_MAX } from "@skiffr/common/constants"
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
const TRACKING_PARAM =
  /^(?:utm_.*|mc_.*|trk.*|track.*|ref|refid|referrer|source|src|campaign|gclid|fbclid|msclkid|dclid|_hs.*|mkt_tok|midtoken|midsig|eid|lipi|lgtl|otptoken|gh_src|lever-.*|sid|cid|click_?id|trackingid|vjs|tk|from|fccid|sk|bb|xkcb|advn|adid)$/i

const LINKEDIN = /(?:^|\.)linkedin\.com$/
const INDEED = /(?:^|\.)indeed\.(?:com|[a-z]{2,3}|co\.[a-z]{2})$/
const GLASSDOOR = /(?:^|\.)glassdoor\.(?:com|[a-z]{2,3}|co\.[a-z]{2})$/
const WELLFOUND = /(?:^|\.)(?:wellfound\.com|angel\.co)$/

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

function known(url: URL): CanonicalUrl | null | undefined {
  const host = url.hostname.toLowerCase()
  const param = (...names: string[]) => names.map((name) => url.searchParams.get(name)).find(Boolean) ?? null
  if (LINKEDIN.test(host)) {
    const id =
      url.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{5,})/)?.[1] ??
      (/\/jobs\//.test(url.pathname) ? param("currentJobId")?.match(/^\d{5,}$/)?.[0] : undefined)
    return id ? job(`https://www.linkedin.com/jobs/view/${id}`, `linkedin:${id}`) : undefined
  }
  if (INDEED.test(host)) {
    const jk = param("jk", "vjk")
    if (!jk) return undefined
    return /^[A-Za-z0-9]{8,40}$/.test(jk) ? job(`https://${host}/viewjob?jk=${jk}`, `indeed:${jk}`) : null
  }
  if (GLASSDOOR.test(host)) {
    const id = param("jl", "jobListingId")
    if (!id) return undefined
    return /^\d{5,}$/.test(id) ? job(`https://${host}/job-listing/j?jl=${id}`, `glassdoor:${id}`) : null
  }
  if (WELLFOUND.test(host)) {
    const id = url.pathname.match(/\/jobs\/(\d{4,})/)?.[1]
    return id ? job(`https://wellfound.com/jobs/${id}`, `wellfound:${id}`) : undefined
  }
  return undefined
}

function generic(url: URL): CanonicalUrl | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  const path = url.pathname.replace(/\/+$/, "") || ""
  const kept = [...url.searchParams]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = new URLSearchParams(kept).toString()
  const id = `${host}${path}${query ? `?${query}` : ""}`
  const clean = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${path}${query ? `?${query}` : ""}`
  if (clean.length > URL_MAX) return null
  return { kind: "job", url: clean, canonicalId: id.length <= SHORT_TEXT_MAX ? id : `url:${sha256(id).slice(0, 32)}` }
}

/**
 * A stable id for the posting a link points at, read from the url alone: nothing is fetched and no redirect is followed,
 * since an email's links are attacker-chosen and tracked. Tracking parameters are dropped, the known boards reduce to
 * `linkedin:<id>`, `indeed:<jk>`, `glassdoor:<id>`, `wellfound:<id>`, any other link to its host and path.
 */
export function canonicalizeJobUrl(raw: string, depth = 0): CanonicalUrl | null {
  const url = parse(raw)
  if (!url) return null
  const fromBoard = known(url)
  if (fromBoard !== undefined) return fromBoard
  if (depth < 2) {
    const target = embeddedTarget(url)
    if (target) return canonicalizeJobUrl(target.href, depth + 1)
  }
  if (
    looksLikeTracker(url) ||
    LINKEDIN.test(url.hostname) ||
    INDEED.test(url.hostname) ||
    GLASSDOOR.test(url.hostname)
  ) {
    url.hash = ""
    url.username = ""
    url.password = ""
    return url.href.length <= URL_MAX ? { kind: "unresolved", url: url.href } : null
  }
  return generic(url)
}

/** The id for a posting that only has a click tracker, so a repeat of it (same title and company) still dedupes. */
export const unresolvedId = (title: string, company: string): string =>
  `redirect:${sha256(`${title.toLowerCase()}|${company.toLowerCase()}`).slice(0, 32)}`
