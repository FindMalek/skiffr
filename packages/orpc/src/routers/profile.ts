import { applicantProfileInputSchema, applicantProfileSchema } from "@skiffr/common/schemas"
import { normalizeLabel } from "@skiffr/common/utils"
import { profile } from "@skiffr/db"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { protectedProcedure } from "../procedures"

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
      const fields = Object.fromEntries(
        Object.entries(input.fields).map(([label, value]) => [normalizeLabel(label), value]),
      )
      const values = { data: input.data, fields, updatedAt: context.now() }
      const [row] = await context.db
        .insert(profile)
        .values({ ...values, userId: context.user.id })
        .onConflictDoUpdate({ target: profile.userId, set: values })
        .returning()
      return row!
    }),

  remove: protectedProcedure
    .route({ method: "DELETE", path: "/profile", summary: "Delete your application profile", tags: ["profile"] })
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ context }) => {
      await context.db.delete(profile).where(eq(profile.userId, context.user.id))
      return { ok: true as const }
    }),
}
