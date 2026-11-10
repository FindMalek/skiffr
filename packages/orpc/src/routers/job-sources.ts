import { ORPCError } from "@orpc/server"
import { jobSourceInputSchema, jobSourceSchema, okSchema } from "@skiffr/common/schemas"
import { jobSource } from "@skiffr/db"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import { protectedProcedure } from "../procedures"

const mine = (userId: string, id: string) => and(eq(jobSource.userId, userId), eq(jobSource.id, id))
const idSchema = z.object({ id: z.uuid() })

export const jobSourcesRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/job-sources",
      summary: "The careers pages the user watches",
      tags: ["job-sources"],
    })
    .output(z.array(jobSourceSchema))
    .handler(({ context }) =>
      context.db
        .select()
        .from(jobSource)
        .where(eq(jobSource.userId, context.user.id))
        .orderBy(asc(jobSource.createdAt)),
    ),

  create: protectedProcedure
    .route({ method: "POST", path: "/job-sources", summary: "Watch a careers page", tags: ["job-sources"] })
    .input(jobSourceInputSchema)
    .output(jobSourceSchema)
    .handler(async ({ context, input }) => {
      const [created] = await context.db
        .insert(jobSource)
        .values({ ...input, userId: context.user.id })
        .onConflictDoNothing()
        .returning()
      if (created) return created
      const [existing] = await context.db
        .select()
        .from(jobSource)
        .where(and(eq(jobSource.userId, context.user.id), eq(jobSource.url, input.url)))
      return existing!
    }),

  markChecked: protectedProcedure
    .route({
      method: "POST",
      path: "/job-sources/{id}/checked",
      summary: "Stamp a source as just checked",
      tags: ["job-sources"],
    })
    .input(idSchema)
    .output(jobSourceSchema)
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .update(jobSource)
        .set({ lastCheckedAt: context.now() })
        .where(mine(context.user.id, input.id))
        .returning()
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Source not found." })
      return row
    }),

  remove: protectedProcedure
    .route({
      method: "DELETE",
      path: "/job-sources/{id}",
      summary: "Stop watching a careers page",
      tags: ["job-sources"],
    })
    .input(idSchema)
    .output(okSchema)
    .handler(async ({ context, input }) => {
      await context.db.delete(jobSource).where(mine(context.user.id, input.id))
      return { ok: true as const }
    }),
}
