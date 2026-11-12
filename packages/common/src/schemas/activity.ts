import { z } from "zod"
import { ACTIVITY_LIMIT_DEFAULT, ACTIVITY_LIMIT_MAX, APPLICATION_STATUSES } from "../constants"
import { queryInt } from "./query"

export const activityListInputSchema = z
  .object({
    /** Only what happened at or after this moment, never older than the feed window. Keep it the same while paging with a cursor. */
    since: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().min(1).max(300).optional(),
    limit: queryInt(z.number().int().min(1).max(ACTIVITY_LIMIT_MAX)).default(ACTIVITY_LIMIT_DEFAULT),
  })
  .prefault({})

export const ACTIVITY_KINDS = [
  "jobs_queued",
  "job_applied",
  "application_stage",
  "answer_learned",
  "answer_corrected",
  "fields_filled",
  "gmail_failed",
  "source_failed",
  "token_expired",
] as const

const base = { id: z.string(), at: z.date() }
const text = z.string()

/** Every string here went through `displayText` on the server: hidden and bidi characters are shown as code points, and long text is clipped. */
export const activityEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("jobs_queued"), source: text, count: z.number().int() }),
  z.object({ ...base, kind: z.literal("job_applied"), title: text, company: text }),
  z.object({
    ...base,
    kind: z.literal("application_stage"),
    stage: z.enum(APPLICATION_STATUSES),
    title: text,
    company: text,
  }),
  z.object({ ...base, kind: z.literal("answer_learned"), label: text }),
  z.object({ ...base, kind: z.literal("answer_corrected"), label: text }),
  z.object({ ...base, kind: z.literal("fields_filled"), site: text, count: z.number().int() }),
  z.object({ ...base, kind: z.literal("gmail_failed"), code: text, needsReconnect: z.boolean() }),
  z.object({ ...base, kind: z.literal("source_failed"), source: text, code: text }),
  z.object({ ...base, kind: z.literal("token_expired"), name: text }),
])

export const activityListSchema = z.object({
  items: z.array(activityEventSchema),
  /** Pass it back as `cursor` for the next page. Null on the last page. */
  nextCursor: z.string().nullable(),
  /** Where the feed actually started: `since`, or the window start when `since` was missing or older. */
  since: z.date(),
})

export type ActivityEvent = z.infer<typeof activityEventSchema>
export type ActivityKind = ActivityEvent["kind"]
