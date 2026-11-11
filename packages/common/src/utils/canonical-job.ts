import { SHORT_TEXT_MAX } from "../constants"

const TRACKING_PARAM =
  /^(utm_.*|ga_.*|_ga|_gl|gclid|dclid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|mkt_tok|_hsenc|_hsmi|ref|refid|referrer|referral|src|source|trk|trkinfo|trackingid|tracking_id|gh_src|lever-source|lever-origin|__jvst|ccuid|vero_id|vero_conv|cid|campaign)$/i

const KEY_MAX = SHORT_TEXT_MAX - 20

/** Vendors whose urls carry a stable job id: the prefix of their canonical ids. */
export const KNOWN_ATS = ["linkedin", "indeed", "greenhouse", "lever", "ashby", "workable"] as const

function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const lower = (text: string) => text.toLowerCase()
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

function known(parsed: URL, host: string): string | null {
  const { pathname, searchParams } = parsed
  if (onDomain(host, "linkedin.com")) {
    const slug = /\/jobs\/view\/([^/?#]+)/.exec(pathname)?.[1]
    const id = (slug && /(\d{5,})$/.exec(slug)?.[1]) || searchParams.get("currentJobId")
    return id && /^\d{5,}$/.test(id) ? `linkedin:${id}` : null
  }
  if (/(^|\.)indeed\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) {
    const jk = lower(searchParams.get("jk") ?? searchParams.get("vjk") ?? "")
    return /^[0-9a-f]{8,32}$/.test(jk) ? `indeed:${jk}` : null
  }
  if (onDomain(host, "greenhouse.io")) {
    const path = /^\/([^/]+)\/jobs\/(\d+)/.exec(pathname)
    if (path) return `greenhouse:${lower(path[1]!)}:${path[2]}`
    const board = searchParams.get("for")
    const token = searchParams.get("token")
    if (pathname.startsWith("/embed/") && board && token && /^\d+$/.test(token)) {
      return `greenhouse:${lower(board)}:${token}`
    }
    return null
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const path = /^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(pathname)
    return path ? `lever:${lower(path[1]!)}:${lower(path[2]!)}` : null
  }
  if (host === "jobs.ashbyhq.com") {
    const path = /^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(pathname)
    return path ? `ashby:${lower(path[1]!)}:${lower(path[2]!)}` : null
  }
  if (host === "apply.workable.com") {
    const path = /^\/([^/]+)\/j\/([0-9a-z]+)(?:\/|$)/i.exec(pathname)
    return path ? `workable:${lower(path[1]!)}:${lower(path[2]!)}` : null
  }
  const ghJid = searchParams.get("gh_jid")
  if (ghJid && /^\d+$/.test(ghJid)) return `greenhouse:${host}:${ghJid}`
  return null
}

/**
 * One id per job however the link was written: the vendor's own job id for LinkedIn, Indeed, Greenhouse, Lever, Ashby
 * and Workable, otherwise the url without its fragment, tracking params, `www.` and trailing slash. A job added from a
 * Gmail alert and from the extension gets the same id, so the unique check on `(user, canonical id)` dedupes it.
 */
export function canonicalJobId(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return `url:${lower(url.trim()).slice(0, KEY_MAX)}`
  }
  const host = lower(parsed.host).replace(/^www\./, "")
  const id = known(parsed, lower(parsed.hostname).replace(/^www\./, ""))
  if (id) return id.length > KEY_MAX ? `${id.slice(0, KEY_MAX)}~${hash(id)}` : id

  const kept = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : ""
  const key = `url:${host}${parsed.pathname.replace(/\/+$/, "")}${query}`
  return key.length > KEY_MAX ? `${key.slice(0, KEY_MAX)}~${hash(key)}` : key
}

/** The ATS vendor of a canonical id, for the application record. */
export function atsFromCanonicalId(canonicalId: string): string {
  const prefix = canonicalId.split(":", 1)[0] ?? ""
  return (KNOWN_ATS as readonly string[]).includes(prefix) ? prefix : "other"
}
