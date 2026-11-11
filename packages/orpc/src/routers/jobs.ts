import { ORPCError } from "@orpc/server"
import { JOB_SOURCES_MAX } from "@skiffr/common/constants"
import {
  jobBulkRemoveSchema,
  jobBulkResultSchema,
  jobBulkUpdateSchema,
  jobCountsSchema,
  jobCreatedSchema,
  jobInputSchema,
  jobListSchema,
  jobSchema,
  jobUpdateSchema,
  okSchema,
} from "@skiffr/common/schemas"
import { job } from "@skiffr/db"
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { queueJob } from "../lib/jobs"
import { mine, orNotFound } from "../lib/owned"
import { protectedProcedure } from "../procedures"

/** A search term is matched literally: `%`, `_` and the escape character mean nothing in it. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`

export const jobsRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/jobs",
      summary: "The signed-in user's jobs, newest first (or oldest first), filtered by status, source or search",
      tags: ["jobs"],
    })
    .input(jobListSchema)
    .output(z.array(jobSchema))
    .handler(({ context, input }) => {
      const pattern = input.q ? likePattern(input.q) : undefined
      const order = input.order === "oldest" ? asc : desc
      return context.db
        .select()
        .from(job)
        .where(
          and(
            eq(job.userId, context.user.id),
            input.status ? eq(job.status, input.status) : undefined,
            input.source ? eq(job.source, input.source) : undefined,
            pattern ? or(ilike(job.company, pattern), ilike(job.title, pattern)) : undefined,
          ),
        )
        .orderBy(order(job.queuedAt), order(job.id))
        .limit(input.limit)
        .offset(input.offset)
    }),

  next: protectedProcedure
    .route({
      method: "GET",
      path: "/jobs/next",
      summary:
        "The oldest queued job, or null. It changes nothing: the job stays queued until it is applied or skipped",
      tags: ["jobs"],
    })
    .output(jobSchema.nullable())
    .handler(async ({ context }) => {
      const [row] = await context.db
        .select()
        .from(job)
        .where(and(eq(job.userId, context.user.id), eq(job.status, "queued")))
        .orderBy(asc(job.queuedAt), asc(job.id))
        .limit(1)
      return row ?? null
    }),

  counts: protectedProcedure
    .route({
      method: "GET",
      path: "/jobs/counts",
      summary: "How many jobs are queued, applied and skipped, and how many came from each source",
      tags: ["jobs"],
    })
    .output(jobCountsSchema)
    .handler(async ({ context }) => {
      const count = sql<number>`count(*)::int`
      const owned = eq(job.userId, context.user.id)
      const [byStatus, bySource] = await Promise.all([
        context.db.select({ status: job.status, count }).from(job).where(owned).groupBy(job.status),
        context.db
          .select({ source: job.source, count })
          .from(job)
          .where(owned)
          .groupBy(job.source)
          .orderBy(desc(count), asc(job.source))
          .limit(JOB_SOURCES_MAX),
      ])
      const status = { queued: 0, applied: 0, skipped: 0 }
      for (const row of byStatus) status[row.status] = row.count
      return { status, sources: bySource }
    }),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/jobs",
      summary: "Queue a job, or return the one already saved with the same canonical id",
      tags: ["jobs"],
    })
    .input(jobInputSchema)
    .output(jobCreatedSchema)
    .handler(async ({ context, input }) => {
      const { job: saved, created } = await queueJob(context.db, context.user.id, input, context.now())
      return { ...saved, created }
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

  bulkUpdate: protectedProcedure
    .route({
      method: "POST",
      path: "/jobs/bulk-update",
      summary: "Queue or skip several jobs at once. Applied jobs are left alone",
      tags: ["jobs"],
    })
    .input(jobBulkUpdateSchema)
    .output(jobBulkResultSchema)
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .update(job)
        .set({ status: input.status, updatedAt: context.now() })
        .where(and(eq(job.userId, context.user.id), inArray(job.id, input.ids), ne(job.status, "applied")))
        .returning({ id: job.id })
      return { count: rows.length }
    }),

  bulkRemove: protectedProcedure
    .route({
      method: "POST",
      path: "/jobs/bulk-remove",
      summary: "Delete several jobs and their applications",
      tags: ["jobs"],
    })
    .input(jobBulkRemoveSchema)
    .output(jobBulkResultSchema)
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .delete(job)
        .where(and(eq(job.userId, context.user.id), inArray(job.id, input.ids)))
        .returning({ id: job.id })
      return { count: rows.length }
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
