import { ORPCError } from "@orpc/server"
import {
  applicantProfileInputSchema,
  applicantProfileSchema,
  okSchema,
  type ProfileFields,
} from "@skiffr/common/schemas"
import { normalizeLabel } from "@skiffr/common/utils"
import { profile } from "@skiffr/db"
import { eq } from "drizzle-orm"
import { protectedProcedure } from "../procedures"

function normalizeFields(fields: ProfileFields): ProfileFields {
  const normalized: ProfileFields = {}
  for (const [label, value] of Object.entries(fields)) {
    const key = normalizeLabel(label)
    if (!key) throw new ORPCError("BAD_REQUEST", { message: `The label "${label}" has no letters or digits.` })
    if (key in normalized) throw new ORPCError("BAD_REQUEST", { message: `Two fields share the label "${key}".` })
    normalized[key] = value
  }
  return normalized
}

export const profileRouter = {
  get: protectedProcedure
    .route({ method: "GET", path: "/profile", summary: "The signed-in user's application profile", tags: ["profile"] })
    .output(applicantProfileSchema.nullable())
    .handler(async ({ context }) => {
      const [row] = await context.db.select().from(profile).where(eq(profile.userId, context.user.id))
      return row ?? null
    }),

  upsert: protectedProcedure
    .route({
      method: "PUT",
      path: "/profile",
      summary: "Create or replace your application profile",
      tags: ["profile"],
    })
    .input(applicantProfileInputSchema)
    .output(applicantProfileSchema)
    .handler(async ({ context, input }) => {
      const values = { data: input.data, fields: normalizeFields(input.fields), updatedAt: context.now() }
      const [row] = await context.db
        .insert(profile)
        .values({ ...values, userId: context.user.id })
        .onConflictDoUpdate({ target: profile.userId, set: values })
        .returning()
      return row!
    }),

  remove: protectedProcedure
    .route({ method: "DELETE", path: "/profile", summary: "Delete your application profile", tags: ["profile"] })
    .output(okSchema)
    .handler(async ({ context }) => {
      await context.db.delete(profile).where(eq(profile.userId, context.user.id))
      return { ok: true as const }
    }),
}
