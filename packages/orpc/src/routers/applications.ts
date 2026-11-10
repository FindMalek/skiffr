import { ORPCError } from "@orpc/server"
import {
  applicationInputSchema,
  applicationListSchema,
  applicationSchema,
  applicationUpdateSchema,
  okSchema,
} from "@skiffr/common/schemas"
import { application, job } from "@skiffr/db"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { protectedProcedure } from "../procedures"

const mine = (userId: string, id: string) => and(eq(application.userId, userId), eq(application.id, id))

/** Each funnel stage has its own timestamp, set the first time the application reaches it. */
const STAGE_COLUMN = {
  responded: "respondedAt",
  interview: "interviewAt",
  offer: "offerAt",
  rejected: "rejectedAt",
} as const

export const applicationsRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/applications",
      summary: "The signed-in user's applications",
      tags: ["applications"],
    })
    .input(applicationListSchema)
    .output(z.array(applicationSchema))
    .handler(({ context, input }) =>
      context.db
        .select()
        .from(application)
        .where(
          and(eq(application.userId, context.user.id), input.status ? eq(application.status, input.status) : undefined),
        )
        .orderBy(desc(application.appliedAt)),
    ),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/applications",
      summary: "Record an application for a job and mark the job applied",
      tags: ["applications"],
    })
    .input(applicationInputSchema)
    .output(applicationSchema)
    .handler(async ({ context, input }) => {
      const now = context.now()
      return context.db.transaction(async (tx) => {
        const [marked] = await tx
          .update(job)
          .set({ status: "applied", updatedAt: now })
          .where(and(eq(job.userId, context.user.id), eq(job.id, input.jobId)))
          .returning({ id: job.id })
        if (!marked) throw new ORPCError("NOT_FOUND", { message: "Job not found." })
        const [row] = await tx
          .insert(application)
          .values({ ...input, userId: context.user.id, appliedAt: now })
          .onConflictDoNothing()
          .returning()
        if (!row) throw new ORPCError("CONFLICT", { message: "This job already has an application." })
        return row
      })
    }),

  update: protectedProcedure
    .route({
      method: "PATCH",
      path: "/applications/{id}",
      summary: "Move an application along the funnel",
      tags: ["applications"],
    })
    .input(applicationUpdateSchema)
    .output(applicationSchema)
    .handler(async ({ context, input: { id, status, ...patch } }) => {
      const now = context.now()
      const [current] = await context.db.select().from(application).where(mine(context.user.id, id))
      if (!current) throw new ORPCError("NOT_FOUND", { message: "Application not found." })
      const stage = status && status !== "applied" ? STAGE_COLUMN[status] : undefined
      const [row] = await context.db
        .update(application)
        .set({
          ...patch,
          ...(status ? { status } : {}),
          ...(stage && !current[stage] ? { [stage]: now } : {}),
          updatedAt: now,
        })
        .where(mine(context.user.id, id))
        .returning()
      return row!
    }),

  remove: protectedProcedure
    .route({ method: "DELETE", path: "/applications/{id}", summary: "Delete an application", tags: ["applications"] })
    .input(z.object({ id: z.uuid() }))
    .output(okSchema)
    .handler(async ({ context, input }) => {
      await context.db.delete(application).where(mine(context.user.id, input.id))
      return { ok: true as const }
    }),
}
