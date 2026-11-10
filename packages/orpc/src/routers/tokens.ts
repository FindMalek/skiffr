import {
  apiTokenInputSchema,
  apiTokenSchema,
  createdApiTokenSchema,
  okSchema,
  whoamiSchema,
} from "@skiffr/common/schemas"
import { apiToken } from "@skiffr/db"
import { and, desc, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { mine, orNotFound } from "../lib/owned"
import { generateToken } from "../lib/tokens"
import { protectedProcedure } from "../procedures"

const DAY_MS = 24 * 60 * 60 * 1000

const publicColumns = {
  id: apiToken.id,
  name: apiToken.name,
  prefix: apiToken.prefix,
  last4: apiToken.last4,
  createdAt: apiToken.createdAt,
  lastUsedAt: apiToken.lastUsedAt,
  expiresAt: apiToken.expiresAt,
  revokedAt: apiToken.revokedAt,
}

/** Session only: a token can't reach these (see `TOKEN_PROCEDURES`), so a leaked token can't mint or list tokens. */
export const tokensRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/tokens", summary: "Your extension tokens", tags: ["tokens"] })
    .output(z.array(apiTokenSchema))
    .handler(({ context }) =>
      context.db
        .select(publicColumns)
        .from(apiToken)
        .where(eq(apiToken.userId, context.user.id))
        .orderBy(desc(apiToken.createdAt)),
    ),

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
      const [row] = await context.db
        .insert(apiToken)
        .values({
          ...stored,
          userId: context.user.id,
          name: input.name,
          createdAt: now,
          expiresAt: input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * DAY_MS),
        })
        .returning(publicColumns)
      return { ...row!, secret }
    }),

  revoke: protectedProcedure
    .route({ method: "POST", path: "/tokens/{id}/revoke", summary: "Revoke a token", tags: ["tokens"] })
    .input(z.object({ id: z.uuid() }))
    .output(okSchema)
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .update(apiToken)
        .set({ revokedAt: context.now() })
        .where(and(mine(apiToken, context.user.id, input.id), isNull(apiToken.revokedAt)))
        .returning({ id: apiToken.id })
      orNotFound(row, "Token")
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
    })),
}
