import { z } from "zod"

/** What the real-site smoke run writes to `summary.json`. Extra keys are ignored: the smoke job may grow without breaking this. */
export const STATUSES = ["ok", "drift", "gone", "blocked", "error", "skipped"] as const

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
  id: z.string(),
  ats: z.string(),
  status: z.enum(STATUSES),
  reasons: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  observation: observationSchema.nullable().default(null),
  ms: z.number().default(0),
})
export const summarySchema = z.array(resultSchema)
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
    id: z.string(),
    ats: z.string().optional(),
    url: z.string(),
    click: z.string().optional(),
    enabled: z.boolean().default(true),
  }),
)
export type SmokeTarget = z.output<typeof targetsSchema>[number]

export const SEVERITIES = ["critical", "high", "medium", "low", "none"] as const
export type Severity = (typeof SEVERITIES)[number]

export const targetReportSchema = z.object({
  id: z.string(),
  ats: z.string(),
  status: z.enum(STATUSES),
  severity: z.enum(SEVERITIES),
  reasons: z.array(z.string()),
  notes: z.array(z.string()),
  filled: z.number().nullable(),
  collected: z.number().nullable(),
  deltas: z.object({ filled: z.number(), collected: z.number() }).nullable(),
  signatureChanged: z.boolean(),
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
  resolved: z.array(z.string()),
})
export type DriftReport = z.output<typeof reportSchema>
