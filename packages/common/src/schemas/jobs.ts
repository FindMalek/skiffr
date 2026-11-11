import { z } from "zod"
import {
  APPLICATION_STATUSES,
  JOB_BULK_MAX,
  JOB_SEARCH_MAX,
  JOB_SETTABLE_STATUSES,
  JOB_SOURCES_MAX,
  JOB_STATUSES,
  SHORT_TEXT_MAX,
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

/** A job link ends up as an `href` the user clicks, so it can't carry a `user:password@` part that makes it look like another host. */
export const jobUrlSchema = httpUrlSchema.pipe(
  z.string().refine((url) => {
    const parsed = new URL(url)
    return !parsed.username && !parsed.password
  }, "The link can't contain a username or password."),
)

const jobText = z.string().trim().min(1).max(SHORT_TEXT_MAX).refine(clean, CLEAN_MESSAGE)

/** `canonicalId` is derived from the url when left out (`canonicalJobId`), which is what makes the same job from two sources one row. */
export const jobInputSchema = z.object({
  url: jobUrlSchema,
  canonicalId: jobText.optional(),
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
  lastCheckedAt: z.date().nullable(),
  createdAt: z.date(),
})

export const jobSourceInputSchema = z.object({ url: httpUrlSchema })

export type Job = z.infer<typeof jobSchema>
export type JobCounts = z.infer<typeof jobCountsSchema>
export type Application = z.infer<typeof applicationSchema>
export type JobSource = z.infer<typeof jobSourceSchema>
