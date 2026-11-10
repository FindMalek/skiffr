import { jobSourceInputSchema, jobSourceSchema, okSchema, pageInputSchema } from "@skiffr/common/schemas"
import { normalizeUrl } from "@skiffr/common/utils"
import { jobSource } from "@skiffr/db"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import { mine, orNotFound } from "../lib/owned"
import { protectedProcedure } from "../procedures"

const idSchema = z.object({ id: z.uuid() })

export const jobSourcesRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/job-sources",
      summary: "The careers pages the user watches",
      tags: ["job-sources"],
    })
    .input(pageInputSchema)
    .output(z.array(jobSourceSchema))
    .handler(({ context, input }) =>
      context.db
        .select()
        .from(jobSource)
        .where(eq(jobSource.userId, context.user.id))
        .orderBy(asc(jobSource.createdAt), asc(jobSource.id))
        .limit(input.limit)
        .offset(input.offset),
    ),

  create: protectedProcedure
    .route({ method: "POST", path: "/job-sources", summary: "Watch a careers page", tags: ["job-sources"] })
    .input(jobSourceInputSchema)
    .output(jobSourceSchema)
    .handler(async ({ context, input }) => {
      const url = normalizeUrl(input.url)
      const [created] = await context.db
        .insert(jobSource)
        .values({ url, userId: context.user.id })
        .onConflictDoNothing()
        .returning()
      if (created) return created
      const [existing] = await context.db
        .select()
        .from(jobSource)
        .where(and(eq(jobSource.userId, context.user.id), eq(jobSource.url, url)))
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
        .where(mine(jobSource, context.user.id, input.id))
        .returning()
      return orNotFound(row, "Source")
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
      const [row] = await context.db
        .delete(jobSource)
        .where(mine(jobSource, context.user.id, input.id))
        .returning({ id: jobSource.id })
      orNotFound(row, "Source")
      return { ok: true as const }
    }),
}
