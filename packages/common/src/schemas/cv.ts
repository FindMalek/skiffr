import { z } from "zod"
import {
  CV_API_KEY_MAX,
  CV_DESCRIPTION_MAX,
  CV_DESCRIPTION_MIN,
  CV_PATCH_OPS_MAX,
  CV_REJECTIONS,
  SHORT_TEXT_MAX,
  URL_MAX,
} from "../constants"
import { CLEAN_MESSAGE, clean } from "./text"

const HTTPS_MESSAGE = "Use the https address of your Reactive Resume."

/** The key travels in a header, so the instance must be https; the server also refuses private addresses when it calls it. */
export const cvBaseUrlSchema = z
  .string()
  .trim()
  .max(URL_MAX)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
    } catch {
      return false
    }
  }, HTTPS_MESSAGE)
  .transform((value) => new URL(value).origin + new URL(value).pathname.replace(/\/+$/, ""))

export const cvConnectInputSchema = z.object({
  baseUrl: cvBaseUrlSchema,
  apiKey: z.string().trim().min(8).max(CV_API_KEY_MAX).refine(clean, CLEAN_MESSAGE),
})

export const cvResumeRefSchema = z.object({ id: z.string(), name: z.string() })

export const cvStatusSchema = z.object({
  /** False when the server has no encryption key: nothing can be connected. */
  configured: z.boolean(),
  /** False without an AI provider key: the connection works, tailoring does not. */
  aiReady: z.boolean(),
  defaultUrl: z.string(),
  connected: z.boolean(),
  baseUrl: z.string().nullable(),
  keyLast4: z.string().nullable(),
  baseResume: cvResumeRefSchema.nullable(),
})

export type CvStatus = z.infer<typeof cvStatusSchema>

export const cvResumesSchema = z.array(cvResumeRefSchema.extend({ updatedAt: z.string() }))
export const cvTestSchema = z.object({ ok: z.literal(true), resumes: z.number() })
export const cvSetBaseInputSchema = z.object({
  resumeId: z.string().trim().min(1).max(100).refine(clean, CLEAN_MESSAGE),
})

const textValue = z.string().max(4_000)
export const cvOperationSchema = z.object({
  op: z.string().max(20),
  path: z.string().max(120),
  from: z.string().max(120).optional(),
  value: z.union([textValue, z.boolean(), z.array(textValue).max(40)]).optional(),
})
export type CvOperation = z.infer<typeof cvOperationSchema>

export const cvChangeSchema = z.object({
  id: z.string(),
  kind: z.enum(["text", "list", "flag", "order"]),
  label: z.string(),
  before: z.array(z.string()),
  after: z.array(z.string()),
})
export type CvChange = z.infer<typeof cvChangeSchema>

export const cvAtsSchema = z.object({
  score: z.number().int().min(0).max(100),
  total: z.number().int(),
  matched: z.array(z.string()),
  missing: z.array(z.string()),
})
export type CvAts = z.infer<typeof cvAtsSchema>

export const cvRejectedSchema = z.object({ reason: z.enum(CV_REJECTIONS), path: z.string() })

const description = z
  .string()
  .trim()
  .min(CV_DESCRIPTION_MIN, `Paste at least ${CV_DESCRIPTION_MIN} characters of the job description.`)
  .max(CV_DESCRIPTION_MAX)
  .refine(clean, CLEAN_MESSAGE)

export const cvPreviewInputSchema = z.object({ jobId: z.uuid(), description })
export const cvApplyInputSchema = cvPreviewInputSchema.extend({
  operations: z.array(cvOperationSchema).max(CV_PATCH_OPS_MAX),
  baseUpdatedAt: z.string().max(SHORT_TEXT_MAX),
})

export const cvPreviewSchema = z.object({
  baseUpdatedAt: z.string(),
  copyName: z.string(),
  operations: z.array(cvOperationSchema),
  changes: z.array(cvChangeSchema),
  rejected: z.array(cvRejectedSchema),
  before: cvAtsSchema,
  after: cvAtsSchema,
})

export const cvApplySchema = z.object({
  resume: cvResumeRefSchema.extend({ url: z.string() }),
  changes: z.array(cvChangeSchema),
  rejected: z.array(cvRejectedSchema),
  before: cvAtsSchema,
  after: cvAtsSchema,
})

export type CvPreview = z.infer<typeof cvPreviewSchema>
export type CvApplied = z.infer<typeof cvApplySchema>

export const cvPdfInputSchema = z.object({ resumeId: z.string().trim().min(1).max(100).refine(clean, CLEAN_MESSAGE) })
export const cvPdfSchema = z.object({ filename: z.string(), base64: z.string() })
