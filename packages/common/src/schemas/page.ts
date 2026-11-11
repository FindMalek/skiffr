import { z } from "zod"
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from "../constants"
import { queryInt } from "./query"

export const pageSchema = z.object({
  limit: queryInt(z.number().int().min(1).max(LIST_LIMIT_MAX)).default(LIST_LIMIT_DEFAULT),
  offset: queryInt(z.number().int().min(0)).default(0),
})

export const pageInputSchema = pageSchema.prefault({})
