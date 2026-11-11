import { ORPCError } from "@orpc/server"
import { GMAIL_LABEL, GMAIL_SENDERS_MAX } from "@skiffr/common/constants"
import {
  gmailDisconnectSchema,
  gmailRecentInputSchema,
  gmailRecentSchema,
  gmailSenderInputSchema,
  gmailSendersSchema,
  gmailStatusSchema,
  gmailSyncSummarySchema,
} from "@skiffr/common/schemas"
import { gmailAccount, gmailMessage, gmailMessageJob, job } from "@skiffr/db"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { disconnect, syncNow } from "../lib/gmail/accounts"
import { DEFAULT_SENDERS, normalizeSender } from "../lib/gmail/senders"
import { protectedProcedure } from "../procedures"

const NOT_CONNECTED = "Connect Gmail first."

/** Everything here is session only: Gmail is not on `TOKEN_PROCEDURES`, so a leaked extension token can't reach a mailbox. */
const publicAccount = {
  id: gmailAccount.id,
  email: gmailAccount.email,
  status: gmailAccount.status,
  lastSyncAt: gmailAccount.lastSyncAt,
  lastError: gmailAccount.lastError,
  senders: gmailAccount.senders,
}

const sendersRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/gmail/senders", summary: "The senders whose mail is read", tags: ["gmail"] })
    .output(gmailSendersSchema)
    .handler(async ({ context }) => {
      const [account] = await context.db
        .select({ senders: gmailAccount.senders })
        .from(gmailAccount)
        .where(eq(gmailAccount.userId, context.user.id))
      return {
        senders: account?.senders ?? [...DEFAULT_SENDERS],
        defaults: [...DEFAULT_SENDERS],
        max: GMAIL_SENDERS_MAX,
      }
    }),

  add: protectedProcedure
    .route({ method: "POST", path: "/gmail/senders", summary: "Read mail from another sender", tags: ["gmail"] })
    .input(gmailSenderInputSchema)
    .output(gmailSendersSchema)
    .handler(({ context, input }) => {
      const sender = normalizeSender(input.sender)
      if (!sender)
        throw new ORPCError("BAD_REQUEST", { message: "Use an address like jobs@site.com or a domain like site.com." })
      return changeSenders(context, (senders) => {
        if (senders.includes(sender)) return senders
        if (senders.length >= GMAIL_SENDERS_MAX) {
          throw new ORPCError("BAD_REQUEST", { message: `At most ${GMAIL_SENDERS_MAX} senders. Remove one first.` })
        }
        return [...senders, sender]
      })
    }),

  remove: protectedProcedure
    .route({ method: "DELETE", path: "/gmail/senders", summary: "Stop reading mail from a sender", tags: ["gmail"] })
    .input(gmailSenderInputSchema)
    .output(gmailSendersSchema)
    .handler(({ context, input }) => {
      const sender = normalizeSender(input.sender) ?? input.sender
      return changeSenders(context, (senders) => senders.filter((existing) => existing !== sender))
    }),
}

type Ctx = Parameters<Parameters<typeof protectedProcedure.handler>[0]>[0]["context"]

/** Read, change and write the list under a row lock, so two edits at once both land. */
async function changeSenders(context: Ctx, change: (senders: string[]) => string[]) {
  const senders = await context.db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: gmailAccount.id, senders: gmailAccount.senders })
      .from(gmailAccount)
      .where(eq(gmailAccount.userId, context.user.id))
      .for("update")
    if (!account) throw new ORPCError("NOT_FOUND", { message: NOT_CONNECTED })
    const next = change(account.senders)
    await tx
      .update(gmailAccount)
      .set({ senders: next, updatedAt: context.now() })
      .where(eq(gmailAccount.id, account.id))
    return next
  })
  return { senders, defaults: [...DEFAULT_SENDERS], max: GMAIL_SENDERS_MAX }
}

export const gmailRouter = {
  status: protectedProcedure
    .route({
      method: "GET",
      path: "/gmail",
      summary: "Whether Gmail is connected and how the last sync went",
      tags: ["gmail"],
    })
    .output(gmailStatusSchema)
    .handler(async ({ context }) => {
      const configured = Boolean(context.gmail)
      const base = {
        configured,
        label: GMAIL_LABEL,
        syncEveryMinutes: context.gmail?.runtime.syncIntervalMinutes ?? 0,
      }
      const [account] = await context.db
        .select(publicAccount)
        .from(gmailAccount)
        .where(eq(gmailAccount.userId, context.user.id))
      if (!account) {
        return {
          ...base,
          connected: false,
          email: null,
          status: null,
          lastSyncAt: null,
          lastError: null,
          counts: { emails: 0, jobs: 0 },
        }
      }
      const [counts] = await context.db
        .select({
          emails: sql<number>`count(*)::int`,
          jobs: sql<number>`coalesce(sum(${gmailMessage.jobsNew}), 0)::int`,
        })
        .from(gmailMessage)
        .where(eq(gmailMessage.accountId, account.id))
      return {
        ...base,
        connected: true,
        email: account.email,
        status: account.status,
        lastSyncAt: account.lastSyncAt,
        lastError: account.lastError,
        counts: { emails: counts?.emails ?? 0, jobs: counts?.jobs ?? 0 },
      }
    }),

  syncNow: protectedProcedure
    .route({ method: "POST", path: "/gmail/sync", summary: "Read the mailbox now (once a minute)", tags: ["gmail"] })
    .output(gmailSyncSummarySchema)
    .handler(async ({ context }) => {
      if (!context.gmail) {
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Gmail import is not configured on this server." })
      }
      const result = await syncNow(
        { db: context.db, runtime: context.gmail.runtime, now: context.now, tokens: context.gmail.tokens },
        context.user.id,
      )
      if (result === "not_connected") throw new ORPCError("NOT_FOUND", { message: NOT_CONNECTED })
      if (result === "too_soon")
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Synced a moment ago. Try again in a minute." })
      return result
    }),

  recent: protectedProcedure
    .route({
      method: "GET",
      path: "/gmail/recent",
      summary: "The latest emails read and the jobs they added",
      tags: ["gmail"],
    })
    .input(gmailRecentInputSchema)
    .output(gmailRecentSchema)
    .handler(async ({ context, input }) => {
      const messages = await context.db
        .select({
          id: gmailMessage.id,
          provider: gmailMessage.provider,
          outcome: gmailMessage.outcome,
          processedAt: gmailMessage.processedAt,
          modifiedAt: gmailMessage.modifiedAt,
          jobsFound: gmailMessage.jobsFound,
          jobsNew: gmailMessage.jobsNew,
        })
        .from(gmailMessage)
        .where(eq(gmailMessage.userId, context.user.id))
        .orderBy(desc(gmailMessage.processedAt), desc(gmailMessage.id))
        .limit(input.limit)
      const linked =
        messages.length === 0
          ? []
          : await context.db
              .select({
                messageId: gmailMessageJob.messageId,
                id: job.id,
                title: job.title,
                company: job.company,
                url: job.url,
                canonicalId: job.canonicalId,
              })
              .from(gmailMessageJob)
              .innerJoin(job, eq(job.id, gmailMessageJob.jobId))
              .where(
                and(
                  inArray(
                    gmailMessageJob.messageId,
                    messages.map((message) => message.id),
                  ),
                  eq(job.userId, context.user.id),
                ),
              )
      return messages.map(({ provider, modifiedAt, ...message }) => ({
        ...message,
        source: `gmail:${provider}`,
        tidied: modifiedAt !== null,
        jobs: linked
          .filter((row) => row.messageId === message.id)
          .map(({ messageId: _messageId, canonicalId, ...row }) => ({
            ...row,
            unresolved: canonicalId.startsWith("redirect:"),
          })),
      }))
    }),

  senders: sendersRouter,

  disconnect: protectedProcedure
    .route({
      method: "DELETE",
      path: "/gmail",
      summary: "Revoke the Google grant and delete the connection. Queued jobs and your mail stay",
      tags: ["gmail"],
    })
    .output(gmailDisconnectSchema)
    .handler(async ({ context }) => {
      const result = await disconnect(context.db, context.gmail?.runtime ?? null, context.user.id)
      if (!result) throw new ORPCError("NOT_FOUND", { message: NOT_CONNECTED })
      return result
    }),
}
