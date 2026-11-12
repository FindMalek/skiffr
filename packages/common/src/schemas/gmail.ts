import { z } from "zod"
import { GMAIL_ACCOUNT_STATUSES, GMAIL_MESSAGE_OUTCOMES, GMAIL_RECENT_MAX, GMAIL_SENDER_MAX } from "../constants"
import { CLEAN_MESSAGE, clean } from "./text"

export const gmailAccountStatusSchema = z.enum(GMAIL_ACCOUNT_STATUSES)
export const gmailOutcomeSchema = z.enum(GMAIL_MESSAGE_OUTCOMES)

export const gmailStatusSchema = z.object({
  /** False when the server has no Google OAuth client: nothing can be connected. */
  configured: z.boolean(),
  connected: z.boolean(),
  email: z.string().nullable(),
  status: gmailAccountStatusSchema.nullable(),
  lastSyncAt: z.date().nullable(),
  /** A fixed code (`auth`, `rate_limited`, ...), never text from Google or an email. */
  lastError: z.string().nullable(),
  label: z.string(),
  syncEveryMinutes: z.number(),
  counts: z.object({ emails: z.number(), jobs: z.number() }),
})

export const gmailSyncSummarySchema = z.object({
  state: z.enum(["done", "busy", "inactive", "stopped"]),
  error: z.string().optional(),
  imported: z.number(),
  duplicates: z.number(),
  noJobs: z.number(),
  skipped: z.number(),
  failed: z.number(),
  jobsAdded: z.number(),
  tidied: z.number(),
})

export const gmailSendersSchema = z.object({
  senders: z.array(z.string()),
  defaults: z.array(z.string()),
  max: z.number(),
})

/** An address (`jobs@site.com`) or a domain (`site.com`). Checked and normalized in the router. */
export const gmailSenderInputSchema = z.object({
  sender: z.string().trim().min(1).max(GMAIL_SENDER_MAX).refine(clean, CLEAN_MESSAGE),
})

export const gmailRecentInputSchema = z
  .object({ limit: z.number().int().min(1).max(GMAIL_RECENT_MAX).default(20) })
  .prefault({})

export const gmailRecentSchema = z.array(
  z.object({
    id: z.string(),
    source: z.string(),
    outcome: gmailOutcomeSchema,
    processedAt: z.date(),
    /** False while the email still has to be marked read and moved out of the inbox. */
    tidied: z.boolean(),
    jobsFound: z.number(),
    jobsNew: z.number(),
    jobs: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        company: z.string(),
        url: z.string(),
        /** The link was a click tracker the posting couldn't be read from. */
        unresolved: z.boolean(),
      }),
    ),
  }),
)

export const gmailDisconnectSchema = z.object({ revoked: z.boolean() })

export type GmailStatus = z.infer<typeof gmailStatusSchema>
export type GmailRecent = z.infer<typeof gmailRecentSchema>
