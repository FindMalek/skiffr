import { ORPCError } from "@orpc/server"
import {
  answerInputSchema,
  answerSchema,
  answerUpdateSchema,
  answerUsageSchema,
  okSchema,
} from "@skiffr/common/schemas"
import { normalizeLabel } from "@skiffr/common/utils"
import { answer } from "@skiffr/db"
import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { protectedProcedure } from "../procedures"

const mine = (userId: string, id: string) => and(eq(answer.userId, userId), eq(answer.id, id))

export const answersRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/answers", summary: "The signed-in user's answer bank", tags: ["answers"] })
    .output(z.array(answerSchema))
    .handler(({ context }) =>
      context.db.select().from(answer).where(eq(answer.userId, context.user.id)).orderBy(asc(answer.normalizedLabel)),
    ),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/answers",
      summary: "Save an answer, replacing the one with the same normalized label",
      tags: ["answers"],
    })
    .input(answerInputSchema)
    .output(answerSchema)
    .handler(async ({ context, input }) => {
      const normalizedLabel = normalizeLabel(input.rawLabel)
      if (!normalizedLabel) throw new ORPCError("BAD_REQUEST", { message: "The label has no letters or digits." })
      const [row] = await context.db
        .insert(answer)
        .values({ ...input, normalizedLabel, userId: context.user.id })
        .onConflictDoUpdate({
          target: [answer.userId, answer.normalizedLabel],
          set: { rawLabel: input.rawLabel, value: input.value, source: input.source, updatedAt: context.now() },
        })
        .returning()
      return row!
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/answers/{id}", summary: "Update an answer", tags: ["answers"] })
    .input(answerUpdateSchema)
    .output(answerSchema)
    .handler(async ({ context, input: { id, ...patch } }) => {
      const [row] = await context.db
        .update(answer)
        .set({ ...patch, updatedAt: context.now() })
        .where(mine(context.user.id, id))
        .returning()
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Answer not found." })
      return row
    }),

  recordUse: protectedProcedure
    .route({
      method: "POST",
      path: "/answers/{id}/use",
      summary: "Count a fill of this answer, and a correction when the user changed it",
      tags: ["answers"],
    })
    .input(answerUsageSchema)
    .output(answerSchema)
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .update(answer)
        .set({
          timesUsed: sql`${answer.timesUsed} + 1`,
          timesCorrected: input.corrected ? sql`${answer.timesCorrected} + 1` : answer.timesCorrected,
          updatedAt: context.now(),
        })
        .where(mine(context.user.id, input.id))
        .returning()
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Answer not found." })
      return row
    }),

  remove: protectedProcedure
    .route({ method: "DELETE", path: "/answers/{id}", summary: "Delete an answer", tags: ["answers"] })
    .input(z.object({ id: z.uuid() }))
    .output(okSchema)
    .handler(async ({ context, input }) => {
      await context.db.delete(answer).where(mine(context.user.id, input.id))
      return { ok: true as const }
    }),
}
