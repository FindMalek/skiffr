import { ORPCError } from "@orpc/server"
import { WATCH_SOURCES_MAX } from "@skiffr/common/constants"
import {
  jobSourceInputSchema,
  jobSourceRunSchema,
  jobSourceSchema,
  jobSourceUpdateSchema,
  okSchema,
  pageInputSchema,
} from "@skiffr/common/schemas"
import { normalizeUrl } from "@skiffr/common/utils"
import { jobSource } from "@skiffr/db"
import { and, asc, count, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { mine, orNotFound } from "../lib/owned"
import { boardOf } from "../lib/watch/boards"
import { FetchError } from "../lib/watch/errors"
import { checkUrl } from "../lib/watch/ip"
import { runNow } from "../lib/watch/run"
import { protectedProcedure } from "../procedures"

const idSchema = z.object({ id: z.uuid() })

/** Everything a source row shows. The fetch bookkeeping (etag, lease, seen ids) never leaves the server. */
const publicSource = {
  id: jobSource.id,
  url: jobSource.url,
  label: jobSource.label,
  kind: jobSource.kind,
  enabled: jobSource.enabled,
  status: jobSource.status,
  lastCheckedAt: jobSource.lastCheckedAt,
  nextAttemptAt: jobSource.nextAttemptAt,
  lastError: jobSource.lastError,
  lastFound: jobSource.lastFound,
  lastAdded: jobSource.lastAdded,
  createdAt: jobSource.createdAt,
}

function publicUrl(raw: string): string {
  try {
    // Checked as written (normalizing would quietly drop credentials) and again as stored.
    checkUrl(raw)
    const url = normalizeUrl(raw)
    checkUrl(url)
    return url
  } catch (error) {
    if (error instanceof FetchError) {
      throw new ORPCError("BAD_REQUEST", { message: "That address can't be watched. Use a public http or https page." })
    }
    throw error
  }
}

/** Every route here is session only: none is on `TOKEN_PROCEDURES`, so a leaked extension token can't make the server fetch anything. */
export const jobSourcesRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/job-sources",
      summary: "The careers pages and feeds the user watches",
      tags: ["job-sources"],
    })
    .input(pageInputSchema)
    .output(z.array(jobSourceSchema))
    .handler(({ context, input }) =>
      context.db
        .select(publicSource)
        .from(jobSource)
        .where(eq(jobSource.userId, context.user.id))
        .orderBy(asc(jobSource.createdAt), asc(jobSource.id))
        .limit(input.limit)
        .offset(input.offset),
    ),

  create: protectedProcedure
    .route({ method: "POST", path: "/job-sources", summary: "Watch a careers page or feed", tags: ["job-sources"] })
    .input(jobSourceInputSchema)
    .output(jobSourceSchema)
    .handler(({ context, input }) => {
      const url = publicUrl(input.url)
      return context.db.transaction(async (tx) => {
        // Counting and inserting under one lock per user, so two requests at once can't both squeeze past the cap.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`job-source:${context.user.id}`}))`)
        const [existing] = await tx
          .select(publicSource)
          .from(jobSource)
          .where(and(eq(jobSource.userId, context.user.id), eq(jobSource.url, url)))
        if (existing) return existing
        const [owned] = await tx.select({ n: count() }).from(jobSource).where(eq(jobSource.userId, context.user.id))
        if ((owned?.n ?? 0) >= WATCH_SOURCES_MAX) {
          throw new ORPCError("BAD_REQUEST", { message: `At most ${WATCH_SOURCES_MAX} sources. Remove one first.` })
        }
        const [created] = await tx
          .insert(jobSource)
          .values({ userId: context.user.id, url, label: input.label, kind: boardOf(url)?.kind ?? "auto" })
          .returning(publicSource)
        return created!
      })
    }),

  update: protectedProcedure
    .route({
      method: "PATCH",
      path: "/job-sources/{id}",
      summary: "Turn a source on or off, or rename it",
      tags: ["job-sources"],
    })
    .input(jobSourceUpdateSchema)
    .output(jobSourceSchema)
    .handler(async ({ context, input }) => {
      const { id, enabled, label } = input
      const [row] = await context.db
        .update(jobSource)
        .set({
          ...(label !== undefined ? { label } : {}),
          ...(enabled !== undefined ? { enabled, ...(enabled ? { nextAttemptAt: null } : {}) } : {}),
          updatedAt: context.now(),
        })
        .where(mine(jobSource, context.user.id, id))
        .returning(publicSource)
      return orNotFound(row, "Source")
    }),

  runNow: protectedProcedure
    .route({
      method: "POST",
      path: "/job-sources/{id}/run",
      summary: "Fetch a source now (once a minute)",
      tags: ["job-sources"],
    })
    .input(idSchema)
    .output(jobSourceRunSchema)
    .handler(async ({ context, input }) => {
      if (!context.watch) {
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Watching sources is not available on this server." })
      }
      const result = await runNow(
        { db: context.db, runtime: context.watch, now: context.now },
        context.user.id,
        input.id,
      )
      if (result === "not_found") throw new ORPCError("NOT_FOUND", { message: "Source not found." })
      if (result === "disabled") throw new ORPCError("CONFLICT", { message: "Turn the source on first." })
      if (result === "too_soon") {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Fetched a moment ago. Try again in a minute." })
      }
      if (result === "too_many") {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "That is a lot of fetches. Try again in a few minutes." })
      }
      return result
    }),

  remove: protectedProcedure
    .route({
      method: "DELETE",
      path: "/job-sources/{id}",
      summary: "Stop watching a source. Jobs already queued stay",
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
