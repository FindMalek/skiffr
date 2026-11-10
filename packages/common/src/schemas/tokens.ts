import { z } from "zod"
import { TOKEN_EXPIRY_DAYS_MAX, TOKEN_NAME_MAX } from "../constants"

export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  last4: z.string(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
})

export const apiTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(TOKEN_NAME_MAX),
  /** `null` never expires. */
  expiresInDays: z.number().int().min(1).max(TOKEN_EXPIRY_DAYS_MAX).nullable(),
})

/** The only response that ever carries the secret. */
export const createdApiTokenSchema = apiTokenSchema.extend({ secret: z.string() })

export const whoamiSchema = z.object({
  user: z.object({ name: z.string(), email: z.string() }),
  token: apiTokenSchema.pick({ name: true, prefix: true, last4: true, expiresAt: true }).nullable(),
})

export type ApiToken = z.infer<typeof apiTokenSchema>
export type Whoami = z.infer<typeof whoamiSchema>
