import { ORPCError } from "@orpc/server"
import { AiInputError, AiModelError, draftAnswer, mapFields } from "@skiffr/ai"
import {
  draftAnswerInputSchema,
  draftAnswerOutputSchema,
  mapFieldsInputSchema,
  mapFieldsOutputSchema,
} from "@skiffr/common/schemas"
import { profile } from "@skiffr/db"
import { eq } from "drizzle-orm"
import type { Context } from "../context"
import { protectedProcedure } from "../procedures"

/** The profile is read here, not sent by the caller: the payload stays small and a client can't ask about someone else's data. */
async function loadAi(context: Context & { user: { id: string } }) {
  if (!context.model) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "No AI provider key is configured." })
  const [row] = await context.db.select().from(profile).where(eq(profile.userId, context.user.id))
  if (!row) throw new ORPCError("PRECONDITION_FAILED", { message: "Save your profile first." })
  return { model: context.model, profile: row }
}

/** Model errors are logged as name, kind, status, model id and request id only: the SDK's own errors carry the whole prompt, which is the applicant's data. */
async function guarded<T>(route: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof AiInputError) throw new ORPCError("BAD_REQUEST", { message: error.message })
    if (!(error instanceof AiModelError)) throw error
    const { name, kind, status, modelId, requestId } = error
    console.error(`[${route}]`, { name, kind, status, modelId, requestId })
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: "The AI is unavailable, try again." })
  }
}

export const aiRouter = {
  mapFields: protectedProcedure
    .route({
      method: "POST",
      path: "/ai/map-fields",
      summary: "Map form fields to profile keys",
      tags: ["ai"],
    })
    .input(mapFieldsInputSchema)
    .output(mapFieldsOutputSchema)
    .handler(async ({ context, input }) => {
      const ai = await loadAi(context)
      return { mappings: await guarded("ai.mapFields", () => mapFields({ ...ai, fields: input.fields })) }
    }),

  draftAnswer: protectedProcedure
    .route({
      method: "POST",
      path: "/ai/draft-answer",
      summary: "Draft an answer to an open question from your profile",
      tags: ["ai"],
    })
    .input(draftAnswerInputSchema)
    .output(draftAnswerOutputSchema)
    .handler(async ({ context, input }) => {
      const ai = await loadAi(context)
      return guarded("ai.draftAnswer", () => draftAnswer({ ...ai, ...input }))
    }),
}
