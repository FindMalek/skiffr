import { z } from "zod"
import {
  APPLICATION_STATUSES,
  JOB_BULK_MAX,
  JOB_SEARCH_MAX,
  JOB_SETTABLE_STATUSES,
  JOB_SOURCES_MAX,
  JOB_STATUSES,
  SHORT_TEXT_MAX,
  URL_MAX,
  WATCH_LABEL_MAX,
  WATCH_SOURCE_KINDS,
  WATCH_SOURCE_STATUSES,
} from "../constants"
import { pageSchema } from "./page"
import { CLEAN_MESSAGE, clean } from "./text"
import { httpUrlSchema } from "./url"

export const jobStatusSchema = z.enum(JOB_STATUSES)
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES)

export const jobSchema = z.object({
  id: z.string(),
  url: z.string(),
  canonicalId: z.string(),
  title: z.string(),
  company: z.string(),
  source: z.string(),
  status: jobStatusSchema,
  queuedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const NOT_PUBLIC_MESSAGE = "That address is not a public job link."
export const CREDENTIALS_MESSAGE = "The link can't contain a username or password."

const PRIVATE_HOST = /(?:^|\.)(?:localhost|local|internal|lan|home\.arpa)$/
const NUMERIC_HOST = /^[\d.]+$|^0x[0-9a-f]+$/i

/**
 * A job link ends up as an `href` the user clicks. So no control characters (postgres rejects a NUL), no
 * `user:password@` part that makes it look like another host, and nothing that points inside a network: `localhost`,
 * `.local`, `.internal`, `.lan`, `.home.arpa`, ip addresses and IPv6 literals.
 */
export const jobUrlSchema = z
  .string()
  .trim()
  .max(URL_MAX)
  .superRefine((value, ctx) => {
    if (!clean(value)) return void ctx.addIssue({ code: "custom", message: CLEAN_MESSAGE })
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return
    if (parsed.username || parsed.password) return void ctx.addIssue({ code: "custom", message: CREDENTIALS_MESSAGE })
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "")
    if (host.startsWith("[") || NUMERIC_HOST.test(host) || PRIVATE_HOST.test(host)) {
      ctx.addIssue({ code: "custom", message: NOT_PUBLIC_MESSAGE })
    }
  })
  .pipe(httpUrlSchema)

const jobText = z.string().trim().min(1).max(SHORT_TEXT_MAX).refine(clean, CLEAN_MESSAGE)

/** The id is always derived from the url on the server (`canonicalizeJob`), so a client can't split one job into two rows by sending its own. */
export const jobInputSchema = z.object({
  url: jobUrlSchema,
  title: jobText,
  company: jobText,
  source: jobText,
})

/** `applied` isn't settable here: only `applications.create` marks a job applied. */
export const jobUpdateSchema = z.object({ id: z.uuid(), status: z.enum(JOB_SETTABLE_STATUSES) })

/** `newest` is the default list; `oldest` is the order the queue is worked in. */
export const JOB_ORDERS = ["newest", "oldest"] as const

export const jobListSchema = pageSchema
  .extend({
    status: jobStatusSchema.optional(),
    source: jobText.optional(),
    /** Matches the company or title, case insensitive. */
    q: z.string().trim().min(1).max(JOB_SEARCH_MAX).refine(clean, CLEAN_MESSAGE).optional(),
    order: z.enum(JOB_ORDERS).default("newest"),
  })
  .prefault({})

export const jobCreatedSchema = jobSchema.extend({ created: z.boolean() })

export const jobCountsSchema = z.object({
  status: z.object({ queued: z.number(), applied: z.number(), skipped: z.number() }),
  sources: z.array(z.object({ source: z.string(), count: z.number() })).max(JOB_SOURCES_MAX),
})

const jobIds = z.array(z.uuid()).min(1).max(JOB_BULK_MAX)
export const jobBulkUpdateSchema = z.object({ ids: jobIds, status: z.enum(JOB_SETTABLE_STATUSES) })
export const jobBulkRemoveSchema = z.object({ ids: jobIds })
export const jobBulkResultSchema = z.object({ count: z.number() })

export const applicationSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  ats: z.string(),
  resumeId: z.string().nullable(),
  matchScore: z.number().nullable(),
  status: applicationStatusSchema,
  appliedAt: z.date(),
  respondedAt: z.date().nullable(),
  interviewAt: z.date().nullable(),
  offerAt: z.date().nullable(),
  rejectedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const applicationInputSchema = z.object({
  jobId: z.uuid(),
  ats: z.string().trim().min(1).max(SHORT_TEXT_MAX),
  resumeId: z.string().trim().min(1).max(SHORT_TEXT_MAX).optional(),
  matchScore: z.number().int().min(0).max(100).optional(),
})

export const applicationUpdateSchema = z.object({
  id: z.uuid(),
  status: applicationStatusSchema.optional(),
  resumeId: z.string().trim().min(1).max(SHORT_TEXT_MAX).nullable().optional(),
  matchScore: z.number().int().min(0).max(100).nullable().optional(),
})

export const applicationListSchema = pageSchema.extend({ status: applicationStatusSchema.optional() }).prefault({})

export const jobSourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  label: z.string(),
  kind: z.enum(WATCH_SOURCE_KINDS),
  enabled: z.boolean(),
  status: z.enum(WATCH_SOURCE_STATUSES),
  lastCheckedAt: z.date().nullable(),
  nextAttemptAt: z.date().nullable(),
  /** A fixed code (`blocked`, `timeout`, ...), never text from the site. */
  lastError: z.string().nullable(),
  lastFound: z.number(),
  lastAdded: z.number(),
  createdAt: z.date(),
})

export const jobSourceInputSchema = z.object({
  url: httpUrlSchema,
  label: z.string().trim().min(1).max(WATCH_LABEL_MAX).refine(clean, CLEAN_MESSAGE),
})

export const jobSourceUpdateSchema = z.object({
  id: z.uuid(),
  enabled: z.boolean().optional(),
  label: jobSourceInputSchema.shape.label.optional(),
})

export const jobSourceRunSchema = z.object({
  state: z.enum(["done", "busy", "stopped"]),
  error: z.string().optional(),
  found: z.number(),
  added: z.number(),
})

export type Job = z.infer<typeof jobSchema>
export type JobCounts = z.infer<typeof jobCountsSchema>
export type Application = z.infer<typeof applicationSchema>
export type JobSource = z.infer<typeof jobSourceSchema>
