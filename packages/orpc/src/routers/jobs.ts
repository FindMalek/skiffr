import { ORPCError } from "@orpc/server"
import { jobInputSchema, jobListSchema, jobSchema, jobUpdateSchema, okSchema } from "@skiffr/common/schemas"
import { job } from "@skiffr/db"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { protectedProcedure } from "../procedures"

const mine = (userId: string, id: string) => and(eq(job.userId, userId), eq(job.id, id))

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
        .orderBy(desc(job.queuedAt)),
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
    .route({ method: "PATCH", path: "/jobs/{id}", summary: "Change a job's status", tags: ["jobs"] })
    .input(jobUpdateSchema)
    .output(jobSchema)
    .handler(async ({ context, input: { id, ...patch } }) => {
      const [row] = await context.db
        .update(job)
        .set({ ...patch, updatedAt: context.now() })
        .where(mine(context.user.id, id))
        .returning()
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Job not found." })
      return row
    }),

  remove: protectedProcedure
    .route({ method: "DELETE", path: "/jobs/{id}", summary: "Delete a job and its application", tags: ["jobs"] })
    .input(z.object({ id: z.uuid() }))
    .output(okSchema)
    .handler(async ({ context, input }) => {
      await context.db.delete(job).where(mine(context.user.id, input.id))
      return { ok: true as const }
    }),
}
