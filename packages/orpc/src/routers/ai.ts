import { ORPCError } from "@orpc/server"
import { draftAnswer, mapFields } from "@skiffr/ai"
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
      return { mappings: await mapFields({ ...ai, fields: input.fields }) }
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
      return { text: await draftAnswer({ ...ai, ...input }) }
    }),
}
