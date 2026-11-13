import { z } from "zod"
import { ACCOUNT_EXPORT_VERSION, PROFILE_NAME_MAX } from "../constants"

export const meSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: z.string().nullable(),
})

export const profileInputSchema = z.object({ name: z.string().trim().min(1).max(PROFILE_NAME_MAX) })

export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  emailVerified: z.boolean(),
  /** Banned now: a ban that has expired does not count. */
  banned: z.boolean(),
  createdAt: z.date(),
})

/** Today's (UTC) model spend against the server's daily limits. A limit of 0 means none. */
export const aiUsageSchema = z.object({
  day: z.string(),
  calls: z.number(),
  tokens: z.number(),
  limits: z.object({ calls: z.number(), tokens: z.number() }),
})

const exportRow = z.record(z.string(), z.unknown())
const exportRows = z.array(exportRow)

/**
 * Everything the user owns, as one document. Rows hold the table's columns in camelCase, minus the user id, secrets
 * (token hashes, sealed keys and refresh tokens, the Reactive Resume key) and embeddings. Lists are in a fixed order.
 */
export const accountExportSchema = z.object({
  version: z.literal(ACCOUNT_EXPORT_VERSION),
  generatedAt: z.date(),
  account: z.object({ name: z.string(), email: z.string(), image: z.string().nullable(), createdAt: z.date() }),
  profile: exportRow.nullable(),
  gmailAccount: exportRow.nullable(),
  cvConnection: exportRow.nullable(),
  answers: exportRows,
  jobs: exportRows,
  applications: exportRows,
  fieldEvents: exportRows,
  siteProfiles: exportRows,
  jobSources: exportRows,
  gmailMessages: exportRows,
  tokens: exportRows,
  aiUsage: exportRows,
})

export const accountDeleteInputSchema = z.object({
  /** The account's email, typed out: a click can't delete an account. */
  confirmEmail: z.string().trim().min(1).max(320),
  /** Required when the account has a password. Without one the session must be recent. */
  password: z.string().max(1024).optional(),
})

export const accountDeleteOutputSchema = z.object({
  ok: z.literal(true),
  /** `null` without a Gmail connection, `false` when Google could not be reached: revoke at myaccount.google.com/permissions. */
  gmailRevoked: z.boolean().nullable(),
  /** `false` when a stored picture could not be removed: the operator has to delete it from the bucket. */
  filesRemoved: z.boolean(),
})

export const okSchema = z.object({ ok: z.literal(true) })

export type Me = z.infer<typeof meSchema>
export type AdminUser = z.infer<typeof adminUserSchema>
export type AiUsage = z.infer<typeof aiUsageSchema>
export type AccountExport = z.infer<typeof accountExportSchema>
