import { z } from "zod"
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from "../constants"

export const pageSchema = z.object({
  limit: z.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
  offset: z.number().int().min(0).default(0),
})

export const pageInputSchema = pageSchema.prefault({})
