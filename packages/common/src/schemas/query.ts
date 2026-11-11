import { z } from "zod"

/** A number that may also arrive as a digit string, which is all a GET query string can carry. JSON types stay strict: `""`, `null`, `[]` and `true` are not numbers. */
export const queryInt = (schema: z.ZodNumber) =>
  z.preprocess((value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value), schema)
