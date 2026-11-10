import { createHash, randomBytes } from "node:crypto"
import type { Session } from "@skiffr/auth"
import { TOKEN_PREFIX } from "@skiffr/common/constants"
import { apiToken, type Db, user } from "@skiffr/db"
import { and, eq, isNull, lt, or } from "drizzle-orm"

const TOKEN_LENGTH = TOKEN_PREFIX.length + 43
const LAST_USED_THROTTLE_MS = 60_000

export interface TokenAuth {
  id: string
  name: string
  prefix: string
  last4: string
  expiresAt: Date | null
  user: Session["user"]
}

/**
 * The only error that leaves a token query. Drizzle's own errors carry the whole statement with its params (the token
 * hash, prefix and last four), so nothing from them is kept except the operation and the postgres code.
 */
export class TokenStoreError extends Error {
  override name = "TokenStoreError"
  constructor(
    readonly operation: string,
    readonly code?: string,
  ) {
    super("The token store failed.")
  }
}

const PG_CODE = /^[0-9A-Z]{5}$/

function pgCode(error: unknown): string | undefined {
  for (let cause = error, depth = 0; cause && typeof cause === "object" && depth < 4; depth++) {
    const code = (cause as { code?: unknown }).code
    if (typeof code === "string" && PG_CODE.test(code)) return code
    cause = (cause as { cause?: unknown }).cause
  }
  return undefined
}

export async function guardTokenDb<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new TokenStoreError(operation, pgCode(error))
  }
}

export const hashToken = (secret: string) => createHash("sha256").update(secret).digest("hex")

export function generateToken() {
  const secret = TOKEN_PREFIX + randomBytes(32).toString("base64url")
  return { secret, prefix: secret.slice(0, 8), last4: secret.slice(-4), tokenHash: hashToken(secret) }
}

/** The secret of an `Authorization: Bearer` header, `null` when the request doesn't use one. */
export function bearerSecret(headers: Headers): string | null {
  const match = /^Bearer(?:\s+(.*))?$/i.exec(headers.get("authorization") ?? "")
  return match ? (match[1] ?? "").trim() : null
}

/** The token's owner, or `null` for anything unknown, malformed, revoked, expired or owned by a banned user. A database failure throws a `TokenStoreError`, it is not a bad token. */
export async function verifyToken(db: Db, secret: string, now: Date): Promise<TokenAuth | null> {
  if (secret.length !== TOKEN_LENGTH || !secret.startsWith(TOKEN_PREFIX)) return null
  const hash = hashToken(secret)
  const [row] = await guardTokenDb("verify", () =>
    db
      .select({ token: apiToken, owner: user })
      .from(apiToken)
      .innerJoin(user, eq(user.id, apiToken.userId))
      .where(eq(apiToken.tokenHash, hash)),
  )
  if (!row) return null
  const { token, owner } = row
  const banned = owner.banned && (!owner.banExpires || owner.banExpires > now)
  if (token.revokedAt || (token.expiresAt && token.expiresAt <= now) || banned) return null

  const staleBefore = new Date(now.getTime() - LAST_USED_THROTTLE_MS)
  await db
    .update(apiToken)
    .set({ lastUsedAt: now })
    .where(and(eq(apiToken.id, token.id), or(isNull(apiToken.lastUsedAt), lt(apiToken.lastUsedAt, staleBefore))))
    .catch((error) => {
      const { name, operation, code } = new TokenStoreError("touch", pgCode(error))
      console.error("[tokens] lastUsedAt failed", { name, operation, code })
    })

  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    last4: token.last4,
    expiresAt: token.expiresAt,
    user: owner as Session["user"],
  }
}
