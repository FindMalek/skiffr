import { z } from "zod"

/** What the real-site smoke run writes to `summary.json`. Extra keys are ignored: the smoke job may grow without breaking this. */
export const STATUSES = ["ok", "drift", "gone", "blocked", "error", "skipped"] as const

/** Ids and board names become file names, table cells and issue text: plain lowercase words only. */
const ID = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(64)
const ATS = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(32)
/** Page derived sentences are cut here, not rejected: one long reason must not make the whole summary unreadable. */
const SENTENCE = z.string().transform((text) => text.slice(0, 500))
const SENTENCES = z.preprocess((value) => (Array.isArray(value) ? value.slice(0, 20) : value), z.array(SENTENCE))

const observationSchema = z.looseObject({
  toast: z.boolean(),
  collected: z.number(),
  filled: z.number(),
  outlined: z.number().default(0),
  left: z.number().default(0),
  sensitiveAsked: z.number().default(0),
  sensitiveFilled: z.number().default(0),
  consoleErrors: z.number().default(0),
  clickMissed: z.boolean().default(false),
})

export const resultSchema = z.looseObject({
  id: ID,
  ats: ATS,
  status: z.enum(STATUSES),
  reasons: SENTENCES.default([]),
  notes: SENTENCES.default([]),
  observation: observationSchema.nullable().default(null),
  /** Non GET requests a page tried that the runner aborted. */
  writesAborted: z.number().default(0),
  ms: z.number().default(0),
})
export const summarySchema = z.array(resultSchema).max(200)
export type SmokeResult = z.output<typeof resultSchema>

/** `baselines/<id>.json` of the smoke job: counts and one hash, never page text. */
export const baselineSchema = z.looseObject({
  recorded: z.string(),
  collected: z.number(),
  filled: z.number(),
  outlined: z.number().default(0),
  signature: z.string(),
})
export type Baseline = z.output<typeof baselineSchema>

/** The entries of `targets.json` this tool reads. */
export const targetsSchema = z.array(
  z.looseObject({
    id: ID,
    ats: ATS.optional(),
    url: z.string(),
    click: z.string().optional(),
    enabled: z.boolean().default(true),
  }),
)
export type SmokeTarget = z.output<typeof targetsSchema>[number]

export const SEVERITIES = ["critical", "high", "medium", "low", "none"] as const
export type Severity = (typeof SEVERITIES)[number]

export const targetReportSchema = z.object({
  id: ID,
  ats: ATS,
  status: z.enum(STATUSES),
  severity: z.enum(SEVERITIES),
  reasons: SENTENCES,
  notes: SENTENCES,
  filled: z.number().nullable(),
  collected: z.number().nullable(),
  deltas: z.object({ filled: z.number(), collected: z.number() }).nullable(),
  signatureChanged: z.boolean(),
  writesAborted: z.number().default(0),
  /** drift that was not in the previous report (or there is no previous report) */
  newSince: z.boolean(),
  /** drift that was already in the previous report */
  persisting: z.boolean(),
  url: z.string().nullable(),
  click: z.string().nullable(),
})
export type TargetReport = z.output<typeof targetReportSchema>

export const reportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  drifted: z.boolean(),
  /** At least one target ended `ok` or `drift`. Without that nothing was checked, which is not the same as clean. */
  verified: z.boolean().default(true),
  totals: z.object({
    targets: z.number(),
    drift: z.number(),
    changed: z.number(),
    ok: z.number(),
    gone: z.number(),
    blocked: z.number(),
    error: z.number(),
    skipped: z.number(),
    bySeverity: z.object({ critical: z.number(), high: z.number(), medium: z.number(), low: z.number() }),
  }),
  targets: z.array(targetReportSchema),
  /** ids that drifted in the previous report and no longer do */
  resolved: z.array(ID),
})
export type DriftReport = z.output<typeof reportSchema>
