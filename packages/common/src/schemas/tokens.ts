import { z } from "zod"
import { TOKEN_EXPIRY_DAYS_MAX, TOKEN_NAME_MAX } from "../constants"

export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  last4: z.string(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  /** Name and version the client sent last (`extension-chrome`, `0.3.1`), null when it never sent them. */
  client: z.string().nullable(),
  clientVersion: z.string().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
})

export const apiTokenInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(TOKEN_NAME_MAX)
    // Letters, marks, symbols, punctuation and spaces; ZWNJ and ZWJ stay for Persian, Urdu and emoji sequences.
    .regex(/^(?:[^\p{C}\p{Zl}\p{Zp}]|[\u200C\u200D])+$/u, "The name can't contain control or hidden characters."),
  /** `null` never expires. */
  expiresInDays: z.number().int().min(1).max(TOKEN_EXPIRY_DAYS_MAX).nullable(),
})

/** The only response that ever carries the secret. */
export const createdApiTokenSchema = apiTokenSchema.extend({ secret: z.string() })

export const whoamiSchema = z.object({
  user: z.object({ name: z.string(), email: z.string() }),
  token: apiTokenSchema.pick({ name: true, prefix: true, last4: true, expiresAt: true }).nullable(),
  /** The api's side of the version handshake: the extension shows "update needed" when it is older than this. */
  minExtensionVersion: z.string(),
})

export const extensionStatusSchema = z.object({
  /** `never`: no token has been used by a skiffr client yet. `stale`: not seen for `EXTENSION_STALE_HOURS`. */
  state: z.enum(["connected", "stale", "never"]),
  lastSeenAt: z.date().nullable(),
  client: z.string().nullable(),
  clientVersion: z.string().nullable(),
  minExtensionVersion: z.string(),
  /** `unknown` when the extension never reported a version (it predates the header). */
  version: z.enum(["ok", "update-needed", "unknown"]),
  /** When the extension last recorded a fill (a field event), not when it last called the api. */
  lastFillAt: z.date().nullable(),
})

export type ApiToken = z.infer<typeof apiTokenSchema>
export type ExtensionStatus = z.infer<typeof extensionStatusSchema>
export type Whoami = z.infer<typeof whoamiSchema>
