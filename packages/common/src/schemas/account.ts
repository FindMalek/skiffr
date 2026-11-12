import { z } from "zod"
import { PROFILE_NAME_MAX } from "../constants"

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
  createdAt: z.date(),
})

/** Today's (UTC) model spend against the server's daily limits. A limit of 0 means none. */
export const aiUsageSchema = z.object({
  day: z.string(),
  calls: z.number(),
  tokens: z.number(),
  limits: z.object({ calls: z.number(), tokens: z.number() }),
})

export const okSchema = z.object({ ok: z.literal(true) })

export type Me = z.infer<typeof meSchema>
export type AiUsage = z.infer<typeof aiUsageSchema>
