import { SHORT_TEXT_MAX } from "../constants"
import { sha256Hex } from "./sha256"

export type JobVendor =
  | "linkedin"
  | "indeed"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "glassdoor"
  | "wellfound"

export type CanonicalJob = {
  /** The one id the same posting always gets: `<vendor>:<id>` for a supported vendor, `url:<...>` for any other site. */
  canonicalId: string
  /** What to store: the vendor's clean link for a supported vendor (never the caller's), the link as given otherwise. */
  url: string
  vendor: JobVendor | null
}

/**
 * The vendors whose job links reduce to the vendor's own id, with the hosts we trust for each. Nothing else gets a
 * vendor id: a link on any other host (`indeed.xyz`, `linkedin.com.evil.com`) is an ordinary `url:` id, so a hostile
 * link can't take over a real job's id and its stored link.
 */
export const JOB_VENDORS: ReadonlyArray<{
  id: JobVendor
  name: string
  hosts: string
  idFrom: string
  cleanUrl: string
}> = [
  {
    id: "linkedin",
    name: "LinkedIn",
    hosts: "linkedin.com and its subdomains",
    idFrom: "/jobs/view/<id>, or currentJobId on a /jobs/ page",
    cleanUrl: "https://www.linkedin.com/jobs/view/<id>",
  },
  {
    id: "indeed",
    name: "Indeed",
    hosts:
      "indeed.com and its subdomains, plus the country domains Indeed runs (indeed.co.uk, indeed.com.au, indeed.co.in, indeed.fr, ...)",
    idFrom: "the 16 hex digit jk (or vjk) param",
    cleanUrl: "https://www.indeed.com/viewjob?jk=<jk>",
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    hosts: "boards / job-boards .greenhouse.io and .eu.greenhouse.io",
    idFrom: "/<board>/jobs/<id>, or the embed for= and token= params",
    cleanUrl: "https://job-boards.greenhouse.io/<board>/jobs/<id>",
  },
  {
    id: "lever",
    name: "Lever",
    hosts: "jobs.lever.co, jobs.eu.lever.co",
    idFrom: "/<company>/<uuid>",
    cleanUrl: "https://jobs.lever.co/<company>/<uuid>",
  },
  {
    id: "ashby",
    name: "Ashby",
    hosts: "jobs.ashbyhq.com",
    idFrom: "/<company>/<uuid>, or the ashby_jid param",
    cleanUrl: "https://jobs.ashbyhq.com/<company>/<uuid>",
  },
  {
    id: "workable",
    name: "Workable",
    hosts: "apply.workable.com, <company>.workable.com",
    idFrom: "/<company>/j/<code>, or /jobs/<id> on the company subdomain",
    cleanUrl: "https://apply.workable.com/<company>/j/<CODE>/",
  },
  {
    id: "glassdoor",
    name: "Glassdoor",
    hosts: "glassdoor.com and its subdomains, plus its country domains",
    idFrom: "the jl (or jobListingId) param",
    cleanUrl: "https://www.glassdoor.com/job-listing/j?jl=<id>",
  },
  {
    id: "wellfound",
    name: "Wellfound",
    hosts: "wellfound.com, angel.co",
    idFrom: "/jobs/<id>",
    cleanUrl: "https://wellfound.com/jobs/<id>",
  },
]

/**
 * Parameters that only ever carry tracking. Names that are a job id on some site (`ref`, `source`, `src`, `cid`,
 * `campaign`, `referral`, ...) are kept: a split costs one extra row, a merge hides a job.
 */
const TRACKING_PARAM =
  /^(?:utm_.+|gclid|dclid|gbraid|wbraid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|mkt_tok|trk|trkinfo|gh_src|lever-source|lever-origin)$/i

const INDEED_COUNTRIES = [
  "co.uk",
  "com.au",
  "co.in",
  "ca",
  "fr",
  "de",
  "es",
  "nl",
  "ie",
  "at",
  "ch",
  "be",
  "pt",
  "no",
  "fi",
  "hu",
  "cz",
  "jp",
  "co.kr",
  "co.nz",
  "co.za",
  "com.br",
  "com.mx",
  "com.sg",
  "com.my",
  "com.ph",
  "com.pk",
  "com.tr",
  "com.tw",
  "com.ar",
  "com.pe",
  "com.co",
  "com.ve",
  "com.vn",
  "ae",
  "qa",
  "ma",
  "ng",
]
const GLASSDOOR_COUNTRIES = [
  "co.uk",
  "ca",
  "com.au",
  "co.in",
  "de",
  "fr",
  "ie",
  "nl",
  "es",
  "it",
  "com.br",
  "com.mx",
  "sg",
  "at",
  "be",
  "ch",
  "co.nz",
  "pl",
]

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)
const onAny = (host: string, base: string, countries: readonly string[]) =>
  onDomain(host, `${base}.com`) || countries.some((country) => onDomain(host, `${base}.${country}`))

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const SEGMENT = "[a-z0-9][a-z0-9._-]{0,99}"
const LEVER_PATH = new RegExp(`^/(${SEGMENT})/(${UUID})(?:/|$)`, "i")
const GREENHOUSE_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.eu.greenhouse.io",
])

const vendor = (id: JobVendor, key: string, url: string): CanonicalJob => ({
  canonicalId: `${id}:${key}`,
  url,
  vendor: id,
})

function known(url: URL, host: string): CanonicalJob | null {
  if (url.port) return null
  const path = url.pathname
  const param = (...names: string[]) => names.map((name) => url.searchParams.get(name)).find((value) => value) ?? null

  if (onDomain(host, "linkedin.com")) {
    const view = /^\/(?:comm\/)?jobs\/view\/(?:[^/]*-)?(\d{5,20})(?:\/|$)/.exec(path)?.[1]
    const current = /^\/(?:comm\/)?jobs\//.test(path) ? /^\d{5,20}$/.exec(param("currentJobId") ?? "")?.[0] : undefined
    const id = view ?? current
    return id ? vendor("linkedin", id, `https://www.linkedin.com/jobs/view/${id}`) : null
  }
  if (onAny(host, "indeed", INDEED_COUNTRIES)) {
    const jk = (param("jk", "vjk") ?? "").toLowerCase()
    return /^[0-9a-f]{16}$/.test(jk) ? vendor("indeed", jk, `https://www.indeed.com/viewjob?jk=${jk}`) : null
  }
  if (onAny(host, "glassdoor", GLASSDOOR_COUNTRIES)) {
    const id = param("jl", "jobListingId") ?? ""
    return /^\d{5,20}$/.test(id) ? vendor("glassdoor", id, `https://www.glassdoor.com/job-listing/j?jl=${id}`) : null
  }
  if (onDomain(host, "wellfound.com") || onDomain(host, "angel.co")) {
    const id = /^\/(?:company\/[^/]+\/)?jobs\/(\d{4,20})(?:[-/]|$)/.exec(path)?.[1]
    return id ? vendor("wellfound", id, `https://wellfound.com/jobs/${id}`) : null
  }
  if (GREENHOUSE_HOSTS.has(host)) {
    const direct = new RegExp(`^/(${SEGMENT})/jobs/(\\d{1,20})(?:/|$)`, "i").exec(path)
    const board = direct?.[1] ?? (path.startsWith("/embed/") ? param("for") : null)
    const id = direct?.[2] ?? (path.startsWith("/embed/") ? param("token") : null)
    if (!board || !id || !new RegExp(`^${SEGMENT}$`, "i").test(board) || !/^\d{1,20}$/.test(id)) return null
    const slug = board.toLowerCase()
    return vendor("greenhouse", `${slug}:${id}`, `https://job-boards.greenhouse.io/${slug}/jobs/${id}`)
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const match = LEVER_PATH.exec(path)
    if (!match) return null
    const [company, id] = [match[1]!.toLowerCase(), match[2]!.toLowerCase()]
    return vendor("lever", `${company}:${id}`, `https://jobs.lever.co/${company}/${id}`)
  }
  if (host === "jobs.ashbyhq.com") {
    const direct = LEVER_PATH.exec(path)
    const company = direct?.[1] ?? new RegExp(`^/(${SEGMENT})/?$`, "i").exec(path)?.[1]
    const id = direct?.[2] ?? new RegExp(`^${UUID}$`, "i").exec(param("ashby_jid") ?? "")?.[0]
    if (!company || !id) return null
    const [slug, key] = [company.toLowerCase(), id.toLowerCase()]
    return vendor("ashby", `${slug}:${key}`, `https://jobs.ashbyhq.com/${slug}/${key}`)
  }
  if (host === "apply.workable.com") {
    const match = new RegExp(`^/(${SEGMENT})/j/([0-9a-z]{5,20})(?:/|$)`, "i").exec(path)
    if (!match) return null
    const [company, code] = [match[1]!.toLowerCase(), match[2]!.toUpperCase()]
    return vendor("workable", `${company}:${code.toLowerCase()}`, `https://apply.workable.com/${company}/j/${code}/`)
  }
  const workable = /^([a-z0-9][a-z0-9-]{0,62})\.workable\.com$/.exec(host)
  if (workable && workable[1] !== "apply" && workable[1] !== "www") {
    const id = /^\/jobs\/(\d{1,20})(?:\/|$)/.exec(path)?.[1]
    return id ? vendor("workable", `${workable[1]}:${id}`, `https://${workable[1]}.workable.com/jobs/${id}`) : null
  }
  return null
}

const fit = (body: string) =>
  body.length + 4 <= SHORT_TEXT_MAX ? `url:${body}` : `url:${sha256Hex(body).slice(0, 32)}`

/**
 * One id per posting however the link was written, from the link alone (nothing is fetched). A supported vendor
 * (`JOB_VENDORS`) gives `<vendor>:<id>` and its clean link. Any other site gives `url:` plus its host (port kept),
 * path and query without tracking params, plus the fragment only when it is a client route (`#/job/1`, `#!/jobs/2`);
 * a longer id is the sha256 of that text. The link is stored as given.
 */
export function canonicalizeJob(raw: string): CanonicalJob {
  const given = raw.trim()
  let url: URL
  try {
    url = new URL(given)
  } catch {
    return { canonicalId: fit(given.toLowerCase()), url: given, vendor: null }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { canonicalId: fit(given.toLowerCase()), url: given, vendor: null }
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  const vendorJob = known(url, hostname)
  if (vendorJob) return vendorJob

  const path = url.pathname.replace(/\/+$/, "").replace(/%[0-9a-f]{2}/gi, (hex) => hex.toUpperCase())
  const kept = [...url.searchParams]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : ""
  const route = /^#!?\//.test(url.hash) ? url.hash : ""
  const host = `${hostname.replace(/^www\./, "")}${url.port ? `:${url.port}` : ""}`
  return { canonicalId: fit(`${host}${path}${query}${route}`), url: given, vendor: null }
}

export const canonicalJobId = (raw: string): string => canonicalizeJob(raw).canonicalId

/** The vendor in a canonical id (for the application record's `ats`), or `other`. */
export function atsFromCanonicalId(canonicalId: string): string {
  const prefix = canonicalId.split(":", 1)[0] ?? ""
  return JOB_VENDORS.some((entry) => entry.id === prefix) ? prefix : "other"
}
