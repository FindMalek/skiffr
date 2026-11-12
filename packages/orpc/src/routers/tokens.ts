import { ORPCError } from "@orpc/server"
import {
  EXTENSION_MIN_VERSION,
  EXTENSION_STALE_HOURS,
  TOKEN_ACTIVE_MAX,
  TOKEN_HISTORY_DAYS,
  TOKEN_LIST_MAX,
} from "@skiffr/common/constants"
import {
  apiTokenInputSchema,
  apiTokenSchema,
  createdApiTokenSchema,
  extensionStatusSchema,
  okSchema,
  whoamiSchema,
} from "@skiffr/common/schemas"
import { isOlderVersion } from "@skiffr/common/utils"
import { apiToken, fieldEvent } from "@skiffr/db"
import { and, count, desc, eq, gt, gte, isNotNull, isNull, like, max, or, type SQL, sql } from "drizzle-orm"
import { z } from "zod"
import { mine, orNotFound } from "../lib/owned"
import { generateToken, guardTokenDb } from "../lib/tokens"
import { protectedProcedure } from "../procedures"

const DAY_MS = 24 * 60 * 60 * 1000

const publicColumns = {
  id: apiToken.id,
  name: apiToken.name,
  prefix: apiToken.prefix,
  last4: apiToken.last4,
  createdAt: apiToken.createdAt,
  lastUsedAt: apiToken.lastUsedAt,
  client: apiToken.client,
  clientVersion: apiToken.clientVersion,
  expiresAt: apiToken.expiresAt,
  revokedAt: apiToken.revokedAt,
}

const isActive = (now: Date): SQL =>
  and(isNull(apiToken.revokedAt), or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, now)))!

/** Session only: a token can't reach these (see `TOKEN_PROCEDURES`), so a leaked token can't mint or list tokens. */
export const tokensRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/tokens",
      summary: `Your active extension tokens, and the ones revoked or expired in the last ${TOKEN_HISTORY_DAYS} days`,
      tags: ["tokens"],
    })
    .output(z.array(apiTokenSchema))
    .handler(({ context }) => {
      const now = context.now()
      const since = new Date(now.getTime() - TOKEN_HISTORY_DAYS * DAY_MS)
      return guardTokenDb("list", () =>
        context.db
          .select(publicColumns)
          .from(apiToken)
          .where(
            and(
              eq(apiToken.userId, context.user.id),
              // Typed column comparisons: a raw Date inside a sql`` template reaches postgres-js unserialized and throws.
              or(
                isActive(now),
                gte(apiToken.revokedAt, since),
                and(isNull(apiToken.revokedAt), gte(apiToken.expiresAt, since)),
              ),
            ),
          )
          // Active first, so the cap on rows can never hide a token that can still be revoked.
          .orderBy(desc(sql`(${isActive(now)})`), desc(apiToken.createdAt))
          .limit(TOKEN_LIST_MAX),
      )
    }),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/tokens",
      summary: "Create a token, the secret is returned once",
      tags: ["tokens"],
    })
    .input(apiTokenInputSchema)
    .output(createdApiTokenSchema)
    .handler(async ({ context, input }) => {
      const { secret, ...stored } = generateToken()
      const now = context.now()
      // One transaction per user at a time, so parallel creates can't all pass the cap check.
      const created = await guardTokenDb("create", () =>
        context.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${context.user.id}))`)
          const [active] = await tx
            .select({ total: count() })
            .from(apiToken)
            .where(and(eq(apiToken.userId, context.user.id), isActive(now)))
          if ((active?.total ?? 0) >= TOKEN_ACTIVE_MAX) return null
          const [row] = await tx
            .insert(apiToken)
            .values({
              ...stored,
              userId: context.user.id,
              name: input.name,
              createdAt: now,
              expiresAt: input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * DAY_MS),
            })
            .returning(publicColumns)
          return row
        }),
      )
      if (!created) {
        throw new ORPCError("BAD_REQUEST", {
          message: `You already have ${TOKEN_ACTIVE_MAX} active tokens. Revoke one to create another.`,
        })
      }
      return { ...created, secret }
    }),

  revoke: protectedProcedure
    .route({ method: "POST", path: "/tokens/{id}/revoke", summary: "Revoke a token", tags: ["tokens"] })
    .input(z.object({ id: z.uuid() }))
    .output(okSchema)
    .handler(async ({ context, input }) => {
      const owned = mine(apiToken, context.user.id, input.id)
      const [revoked] = await guardTokenDb("revoke", () =>
        context.db
          .update(apiToken)
          .set({ revokedAt: context.now() })
          .where(and(owned, isNull(apiToken.revokedAt)))
          .returning({ id: apiToken.id }),
      )
      if (!revoked) {
        // Already revoked is fine (a double click), somebody else's or unknown is not.
        const [existing] = await guardTokenDb("revoke", () =>
          context.db.select({ id: apiToken.id }).from(apiToken).where(owned),
        )
        orNotFound(existing, "Token")
      }
      return { ok: true as const }
    }),
}

export const extensionRouter = {
  whoami: protectedProcedure
    .route({ method: "GET", path: "/extension/whoami", summary: "Who a token belongs to", tags: ["extension"] })
    .output(whoamiSchema)
    .handler(({ context }) => ({
      user: { name: context.user.name, email: context.user.email },
      token: context.token
        ? {
            name: context.token.name,
            prefix: context.token.prefix,
            last4: context.token.last4,
            expiresAt: context.token.expiresAt,
          }
        : null,
      minExtensionVersion: EXTENSION_MIN_VERSION,
    })),

  status: protectedProcedure
    .route({
      method: "GET",
      path: "/extension/status",
      summary: "Whether the extension has been seen lately, which version, and when it last filled",
      tags: ["extension"],
    })
    .output(extensionStatusSchema)
    .handler(async ({ context }) => {
      const now = context.now()
      // The freshest active token an extension used. A token without the extension header (a script) must not hide an outdated extension.
      const [seen] = await guardTokenDb("status", () =>
        context.db
          .select({ lastSeenAt: apiToken.lastUsedAt, client: apiToken.client, clientVersion: apiToken.clientVersion })
          .from(apiToken)
          .where(
            and(
              eq(apiToken.userId, context.user.id),
              isActive(now),
              isNotNull(apiToken.lastUsedAt),
              like(apiToken.client, "extension-%"),
            ),
          )
          .orderBy(desc(apiToken.lastUsedAt))
          .limit(1),
      )
      const [fill] = await context.db
        .select({ at: max(fieldEvent.createdAt) })
        .from(fieldEvent)
        .where(eq(fieldEvent.userId, context.user.id))
      const lastSeenAt = seen?.lastSeenAt ?? null
      const staleBefore = now.getTime() - EXTENSION_STALE_HOURS * 60 * 60 * 1000
      const clientVersion = seen?.clientVersion ?? null
      return {
        state: lastSeenAt
          ? lastSeenAt.getTime() >= staleBefore
            ? ("connected" as const)
            : ("stale" as const)
          : ("never" as const),
        lastSeenAt,
        client: seen?.client ?? null,
        clientVersion,
        minExtensionVersion: EXTENSION_MIN_VERSION,
        version: clientVersion
          ? isOlderVersion(clientVersion, EXTENSION_MIN_VERSION)
            ? ("update-needed" as const)
            : ("ok" as const)
          : ("unknown" as const),
        lastFillAt: fill?.at ?? null,
      }
    }),
}
