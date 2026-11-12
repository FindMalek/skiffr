import { atsFromCanonicalId, canonicalizeJob } from "@skiffr/common/utils"
import { DAY, HOUR, seedId } from "./ids"

type Rand = () => number

export type JobStatus = "queued" | "applied" | "skipped"
export type ApplicationStatus = "applied" | "responded" | "interview" | "offer" | "rejected"

export interface SeedJob {
  id: string
  title: string
  company: string
  source: string
  status: JobStatus
  url: string
  canonicalId: string
  ats: string
  queuedAt: Date
  updatedAt: Date
}

export interface SeedApplication {
  id: string
  jobId: string
  ats: string
  resumeId: string | null
  matchScore: number | null
  status: ApplicationStatus
  appliedAt: Date
  respondedAt: Date | null
  interviewAt: Date | null
  offerAt: Date | null
  rejectedAt: Date | null
}

/** How many of each status a user gets: the demo user's is the full dataset, the other users a smaller slice of it. */
export interface PipelineSize {
  applied: number
  queued: number
  skipped: number
}

export const FULL_PIPELINE: PipelineSize = { applied: 40, queued: 32, skipped: 17 }

/** The watched sources of the demo user: each one is a company on a known board, so its jobs look like that board's. */
export const WATCHED = [
  { label: "Brightwave", slug: "brightwave", vendor: "greenhouse" },
  { label: "Cobalt Peak", slug: "cobalt-peak", vendor: "lever" },
  { label: "Kestrel AI", slug: "kestrel-ai", vendor: "ashby" },
] as const

const COMPANIES = [
  "Lumen Harbor",
  "Quartz Ledger",
  "Fernhill Systems",
  "Mosaic Grid",
  "Paperplane Labs",
  "Tidepool Data",
  "Ironleaf",
  "Northwind Robotics",
  "Saltmarsh Cloud",
  "Copperline",
  "Driftwood Health",
  "Emberstone",
  "Foxglove Finance",
  "Gantry Logistics",
  "Halcyon Pay",
  "Inkwell Media",
  "Juniper Works",
  "Keystone Mobility",
  "Larkspur Energy",
  "Marlow & Finch",
  "Nimbus Forge",
  "Orchard Analytics",
  "Pinecrest Security",
  "Quill Education",
  "Redwood Commerce",
  "Sundial Travel",
  "Thistle Games",
  "Underhill Bio",
  "Vantage Row",
  "Wrenfield",
  "Yarrow Insurance",
  "Zephyr Freight",
]

const TITLES = [
  "Senior Backend Engineer",
  "Staff Software Engineer",
  "Full Stack Engineer (TypeScript)",
  "Platform Engineer",
  "Senior Frontend Engineer",
  "Software Engineer II",
  "Engineering Manager, Payments",
  "DevOps Engineer",
  "Data Engineer",
  "Site Reliability Engineer",
  "Developer Advocate",
  "Principal Engineer",
  "Senior Product Engineer",
  "Backend Engineer (Go)",
  "Mobile Engineer, React Native",
  "Machine Learning Engineer",
  "Security Engineer",
  "QA Automation Engineer",
  "Solutions Engineer",
  "Tech Lead, Infrastructure",
  "Senior Software Engineer, API",
  "Software Engineer, Growth",
  "Infrastructure Engineer",
  "Staff Backend Engineer, Data Platform",
]

const PLACES = [
  "Remote (US)",
  "Remote (EU)",
  "Denver, CO",
  "New York, NY",
  "Austin, TX",
  "Remote",
  "Hybrid, Boulder",
  "Remote (Americas)",
]

const QUEUED_SOURCES = [
  "manual",
  "gmail:linkedin",
  "extension",
  "gmail:indeed",
  "watch:Cobalt Peak",
  "gmail:linkedin",
  "extension",
  "gmail:other",
  "watch:Brightwave",
  "gmail:glassdoor",
  "manual",
  "gmail:linkedin",
  "extension",
  "gmail:indeed",
  "watch:Kestrel AI",
  "gmail:linkedin",
  "extension",
  "gmail:other",
  "watch:Brightwave",
  "gmail:linkedin",
  "manual",
  "gmail:indeed",
  "extension",
  "watch:Cobalt Peak",
  "gmail:glassdoor",
  "gmail:linkedin",
  "watch:Kestrel AI",
  "manual",
  "gmail:indeed",
  "extension",
  "gmail:linkedin",
  "watch:Brightwave",
]
const APPLIED_SOURCES = [
  ...Array<string>(14).fill("extension"),
  ...Array<string>(7).fill("manual"),
  ...Array<string>(7).fill("gmail:linkedin"),
  ...Array<string>(3).fill("gmail:indeed"),
  ...Array<string>(2).fill("gmail:glassdoor"),
  ...Array<string>(2).fill("gmail:other"),
  ...Array<string>(3).fill("watch:Brightwave"),
  ...Array<string>(2).fill("watch:Cobalt Peak"),
]
const SKIPPED_SOURCES = [
  ...Array<string>(5).fill("gmail:linkedin"),
  ...Array<string>(3).fill("gmail:indeed"),
  "gmail:glassdoor",
  "gmail:other",
  "extension",
  "extension",
  "manual",
  "watch:Brightwave",
  "watch:Brightwave",
  "watch:Kestrel AI",
  "watch:Kestrel AI",
]

const OPEN_VENDORS = ["greenhouse", "greenhouse", "lever", "ashby", "workable", "other"] as const

/** Where seeded queued jobs point. One place, so the playground can match it: `<base>/<ats>/<company slug>/jobs/<number>`. */
export const playgroundJobUrl = (base: string, ats: string, slug: string, id: string): string =>
  `${base.replace(/\/+$/, "")}/${ats}/${slug}/jobs/${id}`

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

/** Splits `total` over `weights` by largest remainder, so the parts always add up to `total`. */
export function apportion(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  const exact = weights.map((w) => (w / sum) * total)
  const parts = exact.map(Math.floor)
  const byRemainder = exact
    .map((value, i) => ({ i, rest: value - Math.floor(value) }))
    .sort((x, y) => y.rest - x.rest || x.i - y.i)
  const leftover = total - parts.reduce((s, p) => s + p, 0)
  for (let k = 0; k < leftover; k++) parts[byRemainder[k]!.i]! += 1
  return parts
}

const spread = <T>(list: readonly T[], n: number): T[] =>
  n >= list.length ? [...list] : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]!)

function shuffled<T>(list: readonly T[], rand: Rand): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

const digits = (rand: Rand, n: number) =>
  `${1 + Math.floor(rand() * 9)}${Array.from({ length: n - 1 }, () => Math.floor(rand() * 10)).join("")}`
const hex = (rand: Rand, n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("")
const uuid = (rand: Rand) => `${hex(rand, 8)}-${hex(rand, 4)}-4${hex(rand, 3)}-a${hex(rand, 3)}-${hex(rand, 12)}`

function vendorOf(source: string, rand: Rand): string {
  if (source === "gmail:linkedin") return "linkedin"
  if (source === "gmail:indeed") return "indeed"
  if (source === "gmail:glassdoor") return "glassdoor"
  const watched = WATCHED.find((w) => `watch:${w.label}` === source)
  if (watched) return watched.vendor
  return OPEN_VENDORS[Math.floor(rand() * OPEN_VENDORS.length)]!
}

/** A link in the shape the vendor really uses, with an invented id: the canonical id and the ats come out as they would for a real posting. */
function vendorUrl(vendor: string, slug: string, rand: Rand): string {
  switch (vendor) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${slug}/jobs/${digits(rand, 7)}`
    case "lever":
      return `https://jobs.lever.co/${slug}/${uuid(rand)}`
    case "ashby":
      return `https://jobs.ashbyhq.com/${slug}/${uuid(rand)}`
    case "workable":
      return `https://apply.workable.com/${slug}/j/${hex(rand, 10).toUpperCase()}/`
    case "linkedin":
      return `https://www.linkedin.com/jobs/view/${digits(rand, 10)}`
    case "indeed":
      return `https://www.indeed.com/viewjob?jk=${hex(rand, 16)}`
    case "glassdoor":
      return `https://www.glassdoor.com/job-listing/j?jl=${digits(rand, 10)}`
    default:
      return `https://careers.${slug}.example.invalid/openings/${digits(rand, 5)}`
  }
}

interface Context {
  userId: string
  now: Date
  rand: Rand
  playgroundUrl?: string
}

interface Draft {
  source: string
  status: JobStatus
  queuedAt: Date
  title?: string
  company?: string
  /** Index among the user's jobs, for stable ids. */
  index: number
}

const HOSTILE_TITLE =
  "Senior Engineer\u202eexe.gpj\u200b\u200d <img src=x onerror=alert(1)> {{7*7}} javascript:alert(1)"
const HOSTILE_COMPANY = "<b>Evil</b> & Co \u2066(hidden)\u2069"
const LONG_TITLE = `${"Senior Staff Principal Distinguished Backend Platform Infrastructure ".repeat(3).trim()} Engineer`
const UNICODE_COMPANY = "Café Müller GmbH (東京)"
const UNICODE_TITLE = "Développeur Backend Senior – ingénieur logiciel"

function makeJob(ctx: Context, draft: Draft, companyIndex: number): SeedJob {
  const { rand } = ctx
  const watched = WATCHED.find((w) => `watch:${w.label}` === draft.source)
  const company = draft.company ?? watched?.label ?? COMPANIES[companyIndex % COMPANIES.length]!
  const slug = watched?.slug ?? slugOf(company)
  const vendor = vendorOf(draft.source, rand)
  const place = rand() < 0.45 ? ` (${PLACES[Math.floor(rand() * PLACES.length)]!})` : ""
  const base = draft.title ?? `${TITLES[Math.floor(rand() * TITLES.length)]!}${place}`
  const actionable = draft.status === "queued"
  const number = digits(rand, 7)
  const link = actionable
    ? ctx.playgroundUrl
      ? playgroundJobUrl(ctx.playgroundUrl, vendor === "other" ? "careers" : vendor, slug, number)
      : `https://${vendor === "other" ? "careers" : vendor}.example.invalid/${slug}/jobs/${number}`
    : vendorUrl(vendor, slug, rand)
  const { url, canonicalId } = canonicalizeJob(link)
  return {
    id: seedId(ctx.userId, "job", draft.index),
    title: base,
    company,
    source: draft.source,
    status: draft.status,
    url,
    canonicalId,
    ats: atsFromCanonicalId(canonicalId),
    queuedAt: draft.queuedAt,
    updatedAt: draft.queuedAt,
  }
}

const WEEK_WEIGHTS = [2, 3, 3, 4, 5, 5, 6, 5, 4, 3]
/** Monday to Sunday: applications cluster in the middle of the week. */
const WEEKDAY_WEIGHTS = [3, 5, 5, 4, 2, 0.4, 0.3]
const STATUS_WEIGHTS: [ApplicationStatus, number][] = [
  ["applied", 22],
  ["responded", 4],
  ["interview", 4],
  ["offer", 2],
  ["rejected", 8],
]
/** Share of applications that took under a day, one to three, three to seven and over seven days from queue to apply. */
const GAP_WEIGHTS = [14, 12, 8, 6]
const SCORE_BASE: Record<ApplicationStatus, number> = {
  applied: 66,
  responded: 74,
  interview: 82,
  offer: 90,
  rejected: 58,
}

function pickWeighted(weights: readonly number[], rand: Rand): number {
  let roll = rand() * weights.reduce((s, w) => s + w, 0)
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!
    if (roll < 0) return i
  }
  return weights.length - 1
}

/** When each application was sent: ten weeks, heavier in the middle, busiest on Tuesday to Thursday, rarely on weekends. */
function applicationTimes(n: number, now: Date, rand: Rand): Date[] {
  const times: Date[] = []
  apportion(WEEK_WEIGHTS, n).forEach((count, weekFromOldest) => {
    const weekAgo = WEEK_WEIGHTS.length - 1 - weekFromOldest
    for (let k = 0; k < count; k++) {
      const probe = Array.from({ length: 7 }, (_, d) => {
        const day = new Date(now.getTime() - (weekAgo * 7 + d) * DAY)
        return { d, weight: WEEKDAY_WEIGHTS[(day.getUTCDay() + 6) % 7]! }
      })
      const { d } =
        probe[
          pickWeighted(
            probe.map((p) => p.weight),
            rand,
          )
        ]!
      const base = new Date(now.getTime() - (weekAgo * 7 + d) * DAY)
      base.setUTCHours(8 + Math.floor(rand() * 10), Math.floor(rand() * 60), 0, 0)
      const jitter = rand()
      times.push(base > now ? new Date(now.getTime() - (1 + jitter * 5) * HOUR) : base)
    }
  })
  return times.sort((x, y) => x.getTime() - y.getTime())
}

const clampAfter = (at: number, floor: number, now: Date) =>
  new Date(Math.max(floor, Math.min(at, now.getTime() - HOUR)))

function stagesFor(
  status: ApplicationStatus,
  appliedAt: Date,
  now: Date,
  rand: Rand,
  afterInterview: boolean,
  afterResponse: boolean,
) {
  const t = appliedAt.getTime()
  const days = (min: number, max: number) => (min + rand() * (max - min)) * DAY
  const out = {
    respondedAt: null as Date | null,
    interviewAt: null as Date | null,
    offerAt: null as Date | null,
    rejectedAt: null as Date | null,
  }
  if (status === "applied") return out
  if (status === "rejected" && !afterResponse && !afterInterview) {
    out.rejectedAt = clampAfter(t + days(3, 14), t, now)
    return out
  }
  out.respondedAt = clampAfter(t + days(1, 6), t, now)
  if (status === "responded") return out
  if (status === "rejected" && !afterInterview) {
    out.rejectedAt = clampAfter(out.respondedAt.getTime() + days(2, 9), out.respondedAt.getTime(), now)
    return out
  }
  out.interviewAt = clampAfter(out.respondedAt.getTime() + days(2, 8), out.respondedAt.getTime(), now)
  if (status === "interview") return out
  if (status === "offer") {
    out.offerAt = clampAfter(out.interviewAt.getTime() + days(3, 10), out.interviewAt.getTime(), now)
    return out
  }
  out.rejectedAt = clampAfter(out.interviewAt.getTime() + days(2, 9), out.interviewAt.getTime(), now)
  return out
}

/**
 * Jobs and applications of one user. Applied jobs get the funnel and the timeline: ten weeks of sends with a weekly
 * shape, a spread of queue-to-apply times and match scores that rise with how far the application went. Queued jobs get
 * the "open next" ordering (a few stale ones first, then a mix with whole import batches sharing one timestamp), skipped
 * ones are older. The queued list also holds the odd rows: a hostile title, a very long one, unicode, and twins of
 * other jobs under another source.
 */
export function buildPipeline(ctx: Context, size: PipelineSize) {
  const { rand, now } = ctx
  const companies = shuffled(
    COMPANIES.map((_, i) => i),
    rand,
  )
  let index = 0
  const jobs: SeedJob[] = []
  const applications: SeedApplication[] = []
  const nextCompany = () => companies[index % companies.length]!

  const appliedSources = shuffled(spread(APPLIED_SOURCES, size.applied), rand)
  const times = applicationTimes(size.applied, now, rand)
  const gaps = shuffled(
    apportion(GAP_WEIGHTS, size.applied).flatMap((count, bucket) => Array<number>(count).fill(bucket)),
    rand,
  )
  const gapHours = [() => 2 + rand() * 20, () => 26 + rand() * 44, () => 74 + rand() * 90, () => 170 + rand() * 170]
  const statusCounts = apportion(
    STATUS_WEIGHTS.map(([, w]) => w),
    size.applied,
  )
  const statuses = STATUS_WEIGHTS.flatMap(([status], i) => Array<ApplicationStatus>(statusCounts[i]!).fill(status))
  // Recent applications have had no time to be answered: the answered ones are drawn from the older part of the timeline.
  const answered = statuses.filter((s) => s !== "applied")
  const older = Math.min(size.applied, Math.max(answered.length, Math.floor(size.applied * 0.65)))
  const outcomes = [
    ...shuffled([...answered, ...Array<ApplicationStatus>(older - answered.length).fill("applied")], rand),
    ...Array<ApplicationStatus>(size.applied - older).fill("applied"),
  ]
  const rejected = outcomes.filter((s) => s === "rejected").length
  const interviewedRejections = Math.round(rejected * 0.4)
  const respondedRejections = Math.round(rejected * 0.25)
  let seenRejected = 0

  for (let n = 0; n < size.applied; n++) {
    const appliedAt = times[n]!
    const queuedAt = new Date(appliedAt.getTime() - gapHours[gaps[n]!]!() * HOUR)
    const job = makeJob(ctx, { index: index++, source: appliedSources[n]!, status: "applied", queuedAt }, nextCompany())
    job.updatedAt = appliedAt
    jobs.push(job)
    const status = outcomes[n]!
    const rejectedNo = status === "rejected" ? seenRejected++ : -1
    const afterInterview = rejectedNo >= 0 && rejectedNo < interviewedRejections
    const afterResponse =
      rejectedNo >= interviewedRejections && rejectedNo < interviewedRejections + respondedRejections
    const base = SCORE_BASE[status] + (rand() - 0.5) * 30
    applications.push({
      id: seedId(ctx.userId, "application", n),
      jobId: job.id,
      ats: job.ats,
      resumeId: n % 3 === 0 ? `rr-tailored-${String(n + 1).padStart(2, "0")}` : null,
      matchScore: n % 20 === 7 ? null : Math.max(22, Math.min(98, Math.round(base))),
      status,
      appliedAt,
      ...stagesFor(status, appliedAt, now, rand, afterInterview, afterResponse),
    })
  }

  const queuedSources = spread(QUEUED_SOURCES, size.queued)
  const batchAt = new Map<string, Date>()
  const queued = queuedSources.map((source, n) => {
    const stale = n < 3 ? 13 + rand() * 6 : null
    let queuedAt: Date
    if (source.startsWith("watch:")) {
      if (!batchAt.has(source)) batchAt.set(source, new Date(now.getTime() - (0.9 + rand() * 5) * DAY))
      queuedAt = batchAt.get(source)!
    } else {
      queuedAt = new Date(now.getTime() - (stale ?? 0.1 + rand() * 10) * DAY)
    }
    const draft: Draft = { index: index++, source, status: "queued", queuedAt }
    if (size.queued === FULL_PIPELINE.queued) {
      if (n === 7) Object.assign(draft, { title: HOSTILE_TITLE, company: HOSTILE_COMPANY })
      if (n === 10) draft.title = LONG_TITLE
      if (n === 12) Object.assign(draft, { title: UNICODE_TITLE, company: UNICODE_COMPANY })
    }
    return makeJob(ctx, draft, nextCompany())
  })
  if (size.queued === FULL_PIPELINE.queued) {
    for (const [twin, original] of [
      [3, 1],
      [15, 8],
      [22, 16],
    ] as const) {
      queued[twin]!.title = queued[original]!.title
      queued[twin]!.company = queued[original]!.company
    }
  }
  jobs.push(...queued)

  const skippedSources = shuffled(spread(SKIPPED_SOURCES, size.skipped), rand)
  for (const source of skippedSources) {
    const queuedAt = new Date(now.getTime() - (3 + rand() * 37) * DAY)
    const job = makeJob(ctx, { index: index++, source, status: "skipped", queuedAt }, nextCompany())
    job.updatedAt = new Date(Math.min(now.getTime() - HOUR, queuedAt.getTime() + (1 + rand() * 3) * DAY))
    jobs.push(job)
  }

  return { jobs, applications }
}

/** The same posting as an existing queued job, written the way another channel would link it: tracking parameters, a trailing slash. Adding one of these must not create a second row. */
export function dedupeVariants(
  jobs: readonly Pick<SeedJob, "status" | "url" | "canonicalId" | "title">[],
): { url: string; canonicalId: string; title: string }[] {
  return jobs
    .filter((job) => job.status === "queued")
    .slice(0, 5)
    .map((job) => {
      const url = new URL(job.url)
      url.searchParams.set("utm_source", "newsletter")
      url.searchParams.set("utm_medium", "email")
      if (url.hostname.endsWith("linkedin.com")) url.searchParams.set("trk", "public_jobs_jserp")
      return { url: url.href, canonicalId: job.canonicalId, title: job.title }
    })
}
