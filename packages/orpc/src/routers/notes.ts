import { ORPCError } from "@orpc/server"
import { noteInputSchema, noteSchema, noteStatsSchema, noteUpdateSchema } from "@skiffr/common/schemas"
import { notes } from "@skiffr/db"
import { generateText } from "ai"
import { and, count, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { protectedProcedure } from "../procedures"

const mine = (userId: string, id: string) => and(eq(notes.userId, userId), eq(notes.id, id))

export const notesRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/notes", summary: "The signed-in user's notes", tags: ["notes"] })
    .output(z.array(noteSchema))
    .handler(({ context }) =>
      context.db
        .select()
        .from(notes)
        .where(eq(notes.userId, context.user.id))
        .orderBy(desc(notes.pinned), desc(notes.updatedAt)),
    ),

  stats: protectedProcedure
    .route({ method: "GET", path: "/notes/stats", summary: "Counts for the overview", tags: ["notes"] })
    .output(noteStatsSchema)
    .handler(async ({ context }) => {
      const [all] = await context.db.select({ n: count() }).from(notes).where(eq(notes.userId, context.user.id))
      const [pinned] = await context.db
        .select({ n: count() })
        .from(notes)
        .where(and(eq(notes.userId, context.user.id), eq(notes.pinned, true)))
      return { total: all?.n ?? 0, pinned: pinned?.n ?? 0 }
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/notes", summary: "Create a note", tags: ["notes"] })
    .input(noteInputSchema)
    .output(noteSchema)
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .insert(notes)
        .values({ ...input, userId: context.user.id })
        .returning()
      return row!
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/notes/{id}", summary: "Update a note", tags: ["notes"] })
    .input(noteUpdateSchema)
    .output(noteSchema)
    .handler(async ({ context, input: { id, ...patch } }) => {
      const [row] = await context.db
        .update(notes)
        .set({ ...patch, updatedAt: context.now() })
        .where(mine(context.user.id, id))
        .returning()
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Note not found." })
      return row
    }),

  remove: protectedProcedure
    .route({ method: "DELETE", path: "/notes/{id}", summary: "Delete a note", tags: ["notes"] })
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ context, input }) => {
      await context.db.delete(notes).where(mine(context.user.id, input.id))
      return { ok: true as const }
    }),

  summarize: protectedProcedure
    .route({
      method: "POST",
      path: "/notes/{id}/summary",
      summary: "Summarize a note with the AI model",
      tags: ["notes"],
    })
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ summary: z.string() }))
    .handler(async ({ context, input }) => {
      if (!context.model) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "No AI provider key is configured." })
      const [note] = await context.db.select().from(notes).where(mine(context.user.id, input.id))
      if (!note) throw new ORPCError("NOT_FOUND", { message: "Note not found." })
      const { text } = await generateText({
        model: context.model,
        system: "Summarize the note in one short sentence. Plain text, no preamble.",
        prompt: `${note.title}\n\n${note.body}`,
      })
      return { summary: text.trim() }
    }),
}
