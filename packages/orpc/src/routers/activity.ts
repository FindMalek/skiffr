import { ORPCError } from "@orpc/server"
import { activityListInputSchema, activityListSchema } from "@skiffr/common/schemas"
import { decodeCursor, encodeCursor, feedRows, feedStart, toEvent } from "../lib/activity"
import { protectedProcedure } from "../procedures"

export const activityRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/activity",
      summary:
        "What happened in the signed-in user's account since a moment: jobs queued, applications and their stages, answers learned or corrected, fields filled, and sync failures. Newest first, cursor paged, counts and labels only",
      tags: ["activity"],
    })
    .input(activityListInputSchema)
    .output(activityListSchema)
    .handler(async ({ context, input }) => {
      const cursor = input.cursor ? decodeCursor(input.cursor) : null
      if (input.cursor && !cursor) throw new ORPCError("BAD_REQUEST", { message: "That cursor is not valid." })
      const now = context.now()
      const since = feedStart(now, input.since)
      const rows = await feedRows(context.db, context.user.id, { since, now }, cursor, input.limit + 1)
      const page = rows.slice(0, input.limit)
      const last = page.at(-1)
      return {
        items: page.flatMap((row) => toEvent(row) ?? []),
        nextCursor:
          rows.length > input.limit && last ? encodeCursor({ at: last.at, kind: last.kind, key: last.key }) : null,
        since,
      }
    }),
}
