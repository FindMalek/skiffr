import { z } from "zod"

export const statusSchema = z.object({
  api: z.literal("ok"),
  database: z.enum(["ok", "down"]),
  databaseMs: z.number().nullable(),
  env: z.string(),
})

export type Status = z.infer<typeof statusSchema>
