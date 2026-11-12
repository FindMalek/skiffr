import {
  AI_FIELD_TEXT_MAX,
  AI_OPTION_TEXT_MAX,
  AI_OPTIONS_MAX,
  fieldEventInputSchema,
  fieldMappingSchema,
  LEARNING_FIELDS_MAX,
  siteKeySchema,
} from "@skiffr/common"
import { z } from "zod"
import { FILL_ERROR_CODES, FILL_FIELDS_MAX } from "./fill-config"

export const fillMessageSchema = z.strictObject({ type: z.literal("fill"), skipTop: z.boolean().optional() })
export const formDetectedMessageSchema = z.strictObject({ type: z.literal("form-detected") })
export const frameNavigatedMessageSchema = z.strictObject({ type: z.literal("frame-navigated") })
export const childFormsGoneMessageSchema = z.strictObject({ type: z.literal("child-forms-gone") })
export const reportAgainMessageSchema = z.strictObject({ type: z.literal("report-again") })
export const probeFramesMessageSchema = z.strictObject({ type: z.literal("probe-frames") })
export const fillFramesMessageSchema = z.strictObject({ type: z.literal("fill-frames") })
export const siteDisabledMessageSchema = z.strictObject({ type: z.literal("site-disabled") })
export const disableSiteMessageSchema = z.strictObject({ type: z.literal("disable-site") })
export const testConnectionMessageSchema = z.strictObject({ type: z.literal("test-connection") })
export const openOptionsMessageSchema = z.strictObject({ type: z.literal("open-options") })

/** A submit the person did in a form skiffr filled. */
export const applicationSubmittedMessageSchema = z.strictObject({
  type: z.literal("application-submitted"),
  siteKey: siteKeySchema,
})

/** What the toast may show of a job: text only, already shortened by the worker. */
export const jobBriefSchema = z.strictObject({ title: z.string().max(200), company: z.string().max(200) })

/** The worker offers the next queued job to the top frame. It carries no url: opening one is the worker's job. */
export const nextOfferMessageSchema = z.strictObject({
  type: z.literal("next-offer"),
  offerId: z.uuid(),
  /** The site the submit happened on: the top frame shows the offer only if it is still on it. */
  siteKey: siteKeySchema,
  matched: jobBriefSchema.nullable(),
  next: jobBriefSchema.nullable(),
})

export const NEXT_DECISIONS = ["open", "mark", "dismiss", "never"] as const

/** What the person chose in the next job toast. `open` and `mark` act only on the offer the worker made. */
export const nextDecisionMessageSchema = z.strictObject({
  type: z.literal("next-decision"),
  offerId: z.uuid(),
  action: z.enum(NEXT_DECISIONS),
})

const fieldText = z.string().max(AI_FIELD_TEXT_MAX).optional()

/** What a content script reads off one form control. Page text, so every length is capped. */
export const fillFieldSchema = z.strictObject({
  id: z.string().min(1).max(100),
  label: fieldText,
  name: fieldText,
  ariaLabel: fieldText,
  placeholder: fieldText,
  type: z.string().max(40).optional(),
  autocomplete: z.string().max(100).optional(),
  options: z.array(z.string().max(AI_OPTION_TEXT_MAX)).max(AI_OPTIONS_MAX),
})

export const fillRequestMessageSchema = z.strictObject({
  type: z.literal("fill-request"),
  siteKey: siteKeySchema,
  fields: z
    .array(fillFieldSchema)
    .min(1)
    .max(FILL_FIELDS_MAX)
    .refine((fields) => new Set(fields.map((field) => field.id)).size === fields.length, "Field ids must be unique."),
})

/** What a content script saw after a fill: one event per learnable field, the unchanged and the cleared ones too. */
export const learningRecordMessageSchema = z.strictObject({
  type: z.literal("learning-record"),
  siteKey: siteKeySchema,
  /** Made once per batch and sent again unchanged on a retry. */
  batchId: z.uuid(),
  events: z.array(z.strictObject(fieldEventInputSchema.shape)).min(1).max(LEARNING_FIELDS_MAX),
})

const errorCode = z.enum(FILL_ERROR_CODES)
const count = z.number().int().min(0)

export const fillSummarySchema = z.strictObject({
  /** Fields filled from an answer the person gave before, by how it matched. `site` is what happened last time on this form. */
  site: count,
  exact: count,
  label: count,
  /** Fields copied from the profile and fields given a short generated value. */
  profile: count,
  generated: count,
  /** Filled but below the review confidence: the page outlines them. */
  review: count,
  /** Similar-question answers: shown, never applied. */
  suggested: count,
  skipped: count,
  /** Part of the work failed (set to the first problem) but what is here is still good. */
  problem: errorCode.optional(),
})

export const fillResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    mapping: z.array(fieldMappingSchema),
    values: z.record(z.string(), z.string()),
    /** Field ids that have a saved answer from a similar question. The page may label them, never fill them. */
    suggestions: z.array(z.string()),
    summary: fillSummarySchema,
  }),
  z.strictObject({ ok: z.literal(false), code: errorCode }),
])

/** A child frame tells the top frame how its fill went, through the worker, so one toast can say it. */
export const fillReportMessageSchema = z.strictObject({
  type: z.literal("fill-report"),
  filled: count,
  review: count,
  suggested: count,
  problem: errorCode.optional(),
})

export const learningRecordResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: errorCode }),
])

export const nextJobResponseSchema = learningRecordResponseSchema

export const siteDisabledResponseSchema = z.strictObject({ disabled: z.boolean() })

export type ApplicationSubmittedMessage = z.infer<typeof applicationSubmittedMessageSchema>
export type JobBrief = z.infer<typeof jobBriefSchema>
export type NextOfferMessage = z.infer<typeof nextOfferMessageSchema>
export type NextDecisionMessage = z.infer<typeof nextDecisionMessageSchema>
export type NextJobResponse = z.infer<typeof nextJobResponseSchema>
export type OpenOptionsMessage = z.infer<typeof openOptionsMessageSchema>
export type LearningRecordMessage = z.infer<typeof learningRecordMessageSchema>
export type LearningRecordResponse = z.infer<typeof learningRecordResponseSchema>
export type FillField = z.infer<typeof fillFieldSchema>
export type FillRequestMessage = z.infer<typeof fillRequestMessageSchema>
export type FillSummaryData = z.infer<typeof fillSummarySchema>
export type FillResponse = z.infer<typeof fillResponseSchema>
export type FillReportMessage = z.infer<typeof fillReportMessageSchema>
export type FillMessage = z.infer<typeof fillMessageSchema>
export type FormDetectedMessage = z.infer<typeof formDetectedMessageSchema>
export type FrameNavigatedMessage = z.infer<typeof frameNavigatedMessageSchema>
export type ChildFormsGoneMessage = z.infer<typeof childFormsGoneMessageSchema>
export type ReportAgainMessage = z.infer<typeof reportAgainMessageSchema>
export type ProbeFramesMessage = z.infer<typeof probeFramesMessageSchema>
export type FillFramesMessage = z.infer<typeof fillFramesMessageSchema>
export type SiteDisabledMessage = z.infer<typeof siteDisabledMessageSchema>
export type DisableSiteMessage = z.infer<typeof disableSiteMessageSchema>
export type TestConnectionMessage = z.infer<typeof testConnectionMessageSchema>
export type SiteDisabledResponse = z.infer<typeof siteDisabledResponseSchema>

function guard<T>(schema: z.ZodType<T>): (value: unknown) => value is T {
  return (value): value is T => schema.safeParse(value).success
}

export const isFillMessage = guard(fillMessageSchema)
export const isFormDetectedMessage = guard(formDetectedMessageSchema)
export const isFrameNavigatedMessage = guard(frameNavigatedMessageSchema)
export const isChildFormsGoneMessage = guard(childFormsGoneMessageSchema)
export const isReportAgainMessage = guard(reportAgainMessageSchema)
export const isProbeFramesMessage = guard(probeFramesMessageSchema)
export const isFillFramesMessage = guard(fillFramesMessageSchema)
export const isSiteDisabledMessage = guard(siteDisabledMessageSchema)
export const isDisableSiteMessage = guard(disableSiteMessageSchema)
export const isTestConnectionMessage = guard(testConnectionMessageSchema)
export const isOpenOptionsMessage = guard(openOptionsMessageSchema)
export const isFillReportMessage = guard(fillReportMessageSchema)
export const isNextOfferMessage = guard(nextOfferMessageSchema)
