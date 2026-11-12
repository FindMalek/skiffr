import { ParseError } from "./errors"
import { POSTINGS_MAX, type Posting, toPosting } from "./postings"

export type BoardKind = "greenhouse" | "lever" | "ashby" | "workable"

export interface Board {
  kind: BoardKind
  /** The public json api of the board. Built only from fixed hosts and a slug that passed `SLUG`, so a url can't point it anywhere else. */
  api: string
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/i
const GREENHOUSE_HOSTS = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io"])

const slugOf = (path: string, at = 0): string | null => {
  const segment = path.split("/").filter(Boolean)[at]
  return segment && SLUG.test(segment) ? segment.toLowerCase() : null
}

/** The board a careers url belongs to, read from the exact vendor host: `evil.com/boards.greenhouse.io` and `greenhouse.io.evil.com` are no board. */
export function boardOf(raw: string): Board | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (GREENHOUSE_HOSTS.has(host)) {
    const slug = url.pathname.startsWith("/embed") ? url.searchParams.get("for") : slugOf(url.pathname)
    return slug && SLUG.test(slug)
      ? { kind: "greenhouse", api: `https://boards-api.greenhouse.io/v1/boards/${slug.toLowerCase()}/jobs` }
      : null
  }
  if (host === "boards-api.greenhouse.io") {
    const slug = /^\/v1\/boards\/([^/]+)/.exec(url.pathname)?.[1]
    return slug && SLUG.test(slug)
      ? { kind: "greenhouse", api: `https://boards-api.greenhouse.io/v1/boards/${slug.toLowerCase()}/jobs` }
      : null
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const slug = slugOf(url.pathname)
    const api = host === "jobs.lever.co" ? "api.lever.co" : "api.eu.lever.co"
    return slug ? { kind: "lever", api: `https://${api}/v0/postings/${slug}?mode=json` } : null
  }
  if (host === "jobs.ashbyhq.com") {
    const slug = slugOf(url.pathname)
    return slug ? { kind: "ashby", api: `https://api.ashbyhq.com/posting-api/job-board/${slug}` } : null
  }
  if (host === "apply.workable.com") {
    const slug = slugOf(url.pathname)
    return slug && slug !== "api"
      ? { kind: "workable", api: `https://apply.workable.com/api/v1/widget/accounts/${slug}` }
      : null
  }
  const sub = /^([a-z0-9][a-z0-9-]{0,99})\.workable\.com$/.exec(host)?.[1]
  return sub && sub !== "www" && sub !== "apply"
    ? { kind: "workable", api: `https://apply.workable.com/api/v1/widget/accounts/${sub}` }
    : null
}

const json = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    throw new ParseError()
  }
}

const list = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) throw new ParseError()
  return value
    .slice(0, POSTINGS_MAX)
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
}

const field = (data: unknown, key: string): unknown =>
  data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined

/** Each vendor's public listing, reduced to a link, a title and the company. The link is stored; the posting behind it is never opened. */
export function parseBoard(kind: BoardKind, text: string, api: string, label: string): Posting[] {
  const data = json(text)
  const postings: Array<Posting | null> = []
  if (kind === "greenhouse") {
    for (const job of list(field(data, "jobs")))
      postings.push(toPosting({ url: job.absolute_url, title: job.title, company: job.company_name }, api, label))
  } else if (kind === "lever") {
    for (const job of list(data))
      postings.push(toPosting({ url: job.hostedUrl ?? job.applyUrl, title: job.text }, api, label))
  } else if (kind === "ashby") {
    for (const job of list(field(data, "jobs")))
      if (job.isListed !== false)
        postings.push(toPosting({ url: job.jobUrl ?? job.applyUrl, title: job.title }, api, label))
  } else {
    const company = field(data, "name")
    for (const job of list(field(data, "jobs")))
      postings.push(
        toPosting({ url: job.url ?? job.shortlink ?? job.application_url, title: job.title, company }, api, label),
      )
  }
  return postings.filter((posting): posting is Posting => posting !== null)
}
