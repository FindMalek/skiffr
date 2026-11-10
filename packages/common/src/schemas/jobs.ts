import { z } from "zod"
import { APPLICATION_STATUSES, JOB_STATUSES, SHORT_TEXT_MAX, URL_MAX } from "../constants"

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
  url: z.string().trim().url().max(URL_MAX),
  canonicalId: z.string().trim().min(1).max(SHORT_TEXT_MAX),
  title: z.string().trim().min(1).max(SHORT_TEXT_MAX),
  company: z.string().trim().min(1).max(SHORT_TEXT_MAX),
  source: z.string().trim().min(1).max(SHORT_TEXT_MAX),
})

export const jobUpdateSchema = z.object({ id: z.uuid(), status: jobStatusSchema })

export const jobListSchema = z.object({ status: jobStatusSchema.optional() })

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

export const applicationListSchema = z.object({ status: applicationStatusSchema.optional() })

export const jobSourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  lastCheckedAt: z.date().nullable(),
  createdAt: z.date(),
})

export const jobSourceInputSchema = z.object({ url: z.string().trim().url().max(URL_MAX) })

export type Job = z.infer<typeof jobSchema>
export type Application = z.infer<typeof applicationSchema>
export type JobSource = z.infer<typeof jobSourceSchema>
