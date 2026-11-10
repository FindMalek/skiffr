import { z } from "zod"
import { NOTE_BODY_MAX, NOTE_TITLE_MAX } from "../constants"

export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  pinned: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const noteInputSchema = z.object({
  title: z.string().trim().min(1).max(NOTE_TITLE_MAX),
  body: z.string().max(NOTE_BODY_MAX).default(""),
  pinned: z.boolean().default(false),
})

export const noteUpdateSchema = noteInputSchema.partial().extend({ id: z.uuid() })

export const noteStatsSchema = z.object({ total: z.number(), pinned: z.number() })

export type Note = z.infer<typeof noteSchema>
