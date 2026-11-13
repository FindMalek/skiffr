import { ORPCError } from "@orpc/server"
import { ACCOUNT_FRESH_SESSION_MINUTES, ADMIN_LIST_LIMIT } from "@skiffr/common/constants"
import {
  accountDeleteInputSchema,
  accountDeleteOutputSchema,
  accountExportSchema,
  adminUserSchema,
  aiUsageSchema,
  meSchema,
  okSchema,
  profileInputSchema,
} from "@skiffr/common/schemas"
import { account, session as sessionTable, user } from "@skiffr/db"
import { and, count, desc, eq, isNotNull } from "drizzle-orm"
import { z } from "zod"
import type { Context } from "../context"
import { deleteAccount } from "../lib/account/delete"
import { buildExport } from "../lib/account/export"
import { aiUsageToday } from "../lib/ai-usage"
import { adminProcedure, protectedProcedure } from "../procedures"

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

export const meRouter = {
  get: protectedProcedure
    .route({ method: "GET", path: "/me", summary: "The signed-in user", tags: ["account"] })
    .output(meSchema)
    .handler(({ context }) => ({
      id: context.user.id,
      name: context.user.name,
      email: context.user.email,
      image: context.user.image ?? null,
      role: context.user.role ?? null,
    })),

  usage: protectedProcedure
    .route({
      method: "GET",
      path: "/me/usage",
      summary: "Today's AI calls and tokens against the daily limits",
      tags: ["account"],
    })
    .output(aiUsageSchema)
    .handler(({ context }) => aiUsageToday(context)),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/me", summary: "Update your profile", tags: ["account"] })
    .input(profileInputSchema)
    .output(okSchema)
    .handler(async ({ context, input }) => {
      const changed = await context.db
        .update(user)
        .set({ name: input.name, updatedAt: context.now() })
        .where(eq(user.id, context.user.id))
        .returning({ id: user.id })
      if (changed.length === 0) throw new ORPCError("NOT_FOUND", { message: "This account no longer exists." })
      return { ok: true as const }
    }),

  avatar: protectedProcedure
    .route({ method: "POST", path: "/me/avatar", summary: "Upload a profile picture to S3", tags: ["account"] })
    .input(z.object({ file: z.instanceof(File) }))
    .output(z.object({ image: z.string() }))
    .handler(async ({ context, input }) => {
      if (!context.storage) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Storage isn't configured here." })
      const ext = IMAGE_TYPES[input.file.type]
      if (!ext) throw new ORPCError("UNSUPPORTED_MEDIA_TYPE", { message: "Use a JPEG, PNG or WebP image." })
      if (input.file.size > 4 * 1024 * 1024) throw new ORPCError("PAYLOAD_TOO_LARGE", { message: "4 MB at most." })
      const key = `${context.storage.prefix}avatars/${context.user.id}-${Date.now()}.${ext}`
      await context.storage.put(key, await input.file.arrayBuffer(), input.file.type)
      const image = `/api/files/${key}`
      const changed = await context.db
        .update(user)
        .set({ image, updatedAt: context.now() })
        .where(eq(user.id, context.user.id))
        .returning({ id: user.id })
      if (changed.length === 0) {
        // The account was deleted while this request ran: nothing would ever point at the file.
        await context.storage.delete(key).catch(() => {})
        throw new ORPCError("NOT_FOUND", { message: "This account no longer exists." })
      }
      return { image }
    }),
}

/**
 * Deleting needs more than a session cookie: a password the account really has, or a sign-in from the last few minutes
 * for one without a password (GitHub, magic link). Both come after the typed email.
 */
async function confirmDeletion(
  context: Context & { user: { id: string; email: string } },
  input: { confirmEmail: string; password?: string },
): Promise<void> {
  if (input.confirmEmail.toLowerCase() !== context.user.email.toLowerCase()) {
    throw new ORPCError("BAD_REQUEST", { message: "That is not the email of this account." })
  }
  const [credential] = await context.db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, context.user.id), eq(account.providerId, "credential"), isNotNull(account.password)))
  if (credential) {
    if (!input.password || !(await passwordIsRight(context, input.password))) {
      throw new ORPCError("UNAUTHORIZED", { message: "Wrong password." })
    }
    return
  }
  // The authoritative session row, not the cookie cache: a session the user revoked a minute ago is not fresh.
  const row = await sessionRow(context)
  if (!row || context.now().getTime() - row.createdAt.getTime() > ACCOUNT_FRESH_SESSION_MINUTES * 60_000) {
    throw new ORPCError("FORBIDDEN", { message: "Sign in again, then delete your account." })
  }
}

/** Only a wrong password is "wrong password": any other failure (database, session) stays the server error it is. */
async function passwordIsRight(context: Context, password: string): Promise<boolean> {
  try {
    await context.auth.api.verifyPassword({ body: { password }, headers: context.headers })
    return true
  } catch (error) {
    if ((error as { body?: { code?: string } }).body?.code === "INVALID_PASSWORD") return false
    throw error
  }
}

async function sessionRow(context: Context) {
  if (!context.session) return undefined
  const [row] = await context.db
    .select({ createdAt: sessionTable.createdAt, impersonatedBy: sessionTable.impersonatedBy })
    .from(sessionTable)
    .where(eq(sessionTable.id, context.session.session.id))
  return row
}

/** An admin impersonating a user is not the user: no export, no deletion, whatever the password says. */
async function refuseImpersonation(context: Context): Promise<void> {
  if ((await sessionRow(context))?.impersonatedBy) {
    throw new ORPCError("FORBIDDEN", { message: "Not while signed in as someone else." })
  }
}

/** Session only, like the rest of `account`: a leaked extension token can't read or erase a user's data. */
export const accountRouter = {
  export: protectedProcedure
    .route({
      method: "GET",
      path: "/account/export",
      summary: "Everything you own as one JSON document, without secrets",
      tags: ["account"],
    })
    .output(accountExportSchema)
    .handler(async ({ context }) => {
      await refuseImpersonation(context)
      const [owner] = await context.db.select().from(user).where(eq(user.id, context.user.id))
      if (!owner) throw new ORPCError("NOT_FOUND", { message: "This account no longer exists." })
      const document = await buildExport(context.db, owner, context.now())
      console.info("[account.export]", { requestId: (context as { requestId?: string }).requestId })
      return document
    }),

  delete: protectedProcedure
    .route({
      method: "POST",
      path: "/account/delete",
      summary: "Delete your account and all your data now, this can't be undone",
      tags: ["account"],
    })
    .input(accountDeleteInputSchema)
    .output(accountDeleteOutputSchema)
    .handler(async ({ context, input }) => {
      await refuseImpersonation(context)
      await confirmDeletion(context, input)
      const result = await deleteAccount(
        { db: context.db, gmail: context.gmail, storage: context.storage },
        context.user,
      )
      console.info("[account.delete]", { requestId: (context as { requestId?: string }).requestId, ...result })
      return { ok: true as const, ...result }
    }),
}

export const adminRouter = {
  users: adminProcedure
    .route({ method: "GET", path: "/admin/users", summary: "All users (admins only)", tags: ["admin"] })
    .output(
      z.object({
        total: z.number(),
        users: z.array(adminUserSchema),
      }),
    )
    .handler(async ({ context }) => {
      const [total] = await context.db.select({ n: count() }).from(user)
      const users = await context.db
        .select({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })
        .from(user)
        .orderBy(desc(user.createdAt))
        .limit(ADMIN_LIST_LIMIT)
      return { total: total?.n ?? 0, users }
    }),
}
