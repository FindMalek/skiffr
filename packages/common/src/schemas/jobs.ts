import { z } from "zod"
import { APPLICATION_STATUSES, JOB_SETTABLE_STATUSES, JOB_STATUSES, SHORT_TEXT_MAX } from "../constants"
import { pageSchema } from "./page"
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

export const jobInputSchema = z.object({
  url: httpUrlSchema,
  canonicalId: z.string().trim().min(1).max(SHORT_TEXT_MAX),
  title: z.string().trim().min(1).max(SHORT_TEXT_MAX),
  company: z.string().trim().min(1).max(SHORT_TEXT_MAX),
  source: z.string().trim().min(1).max(SHORT_TEXT_MAX),
})

/** `applied` isn't settable here: only `applications.create` marks a job applied. */
export const jobUpdateSchema = z.object({ id: z.uuid(), status: z.enum(JOB_SETTABLE_STATUSES) })

export const jobListSchema = pageSchema.extend({ status: jobStatusSchema.optional() }).prefault({})

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
export type Application = z.infer<typeof applicationSchema>
export type JobSource = z.infer<typeof jobSourceSchema>
