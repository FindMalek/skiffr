import { ORPCError } from "@orpc/server"
import { jobInputSchema, jobListSchema, jobSchema, jobUpdateSchema, okSchema } from "@skiffr/common/schemas"
import { job } from "@skiffr/db"
import { and, desc, eq, ne } from "drizzle-orm"
import { z } from "zod"
import { mine, orNotFound } from "../lib/owned"
import { protectedProcedure } from "../procedures"

export const jobsRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/jobs", summary: "The signed-in user's jobs, newest first", tags: ["jobs"] })
    .input(jobListSchema)
    .output(z.array(jobSchema))
    .handler(({ context, input }) =>
      context.db
        .select()
        .from(job)
        .where(and(eq(job.userId, context.user.id), input.status ? eq(job.status, input.status) : undefined))
        .orderBy(desc(job.queuedAt), desc(job.id))
        .limit(input.limit)
        .offset(input.offset),
    ),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/jobs",
      summary: "Queue a job, or return the one already saved with the same canonical id",
      tags: ["jobs"],
    })
    .input(jobInputSchema)
    .output(jobSchema)
    .handler(async ({ context, input }) => {
      const [created] = await context.db
        .insert(job)
        .values({ ...input, userId: context.user.id, queuedAt: context.now() })
        .onConflictDoNothing()
        .returning()
      if (created) return created
      const [existing] = await context.db
        .select()
        .from(job)
        .where(and(eq(job.userId, context.user.id), eq(job.canonicalId, input.canonicalId)))
      return existing!
    }),

  update: protectedProcedure
    .route({
      method: "PATCH",
      path: "/jobs/{id}",
      summary: "Queue or skip a job. Applied is only set by recording an application",
      tags: ["jobs"],
    })
    .input(jobUpdateSchema)
    .output(jobSchema)
    .handler(async ({ context, input: { id, ...patch } }) => {
      const [row] = await context.db
        .update(job)
        .set({ ...patch, updatedAt: context.now() })
        .where(and(mine(job, context.user.id, id), ne(job.status, "applied")))
        .returning()
      if (row) return row
      const [existing] = await context.db
        .select({ id: job.id })
        .from(job)
        .where(mine(job, context.user.id, id))
      if (existing) throw new ORPCError("CONFLICT", { message: "The job has an application: remove it first." })
      throw new ORPCError("NOT_FOUND", { message: "Job not found." })
    }),

  remove: protectedProcedure
    .route({ method: "DELETE", path: "/jobs/{id}", summary: "Delete a job and its application", tags: ["jobs"] })
    .input(z.object({ id: z.uuid() }))
    .output(okSchema)
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .delete(job)
        .where(mine(job, context.user.id, input.id))
        .returning({ id: job.id })
      orNotFound(row, "Job")
      return { ok: true as const }
    }),
}
