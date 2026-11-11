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
 * hash, prefix and last four), so nothing from them is kept except the operation, the postgres or socket code
 * (`22021`, `ECONNREFUSED`) and the class of the underlying error (`TypeError`, `PostgresError`).
 */
export class TokenStoreError extends Error {
  override name = "TokenStoreError"
  constructor(
    readonly operation: string,
    readonly code?: string,
    readonly causeName?: string,
  ) {
    super("The token store failed.")
  }
}

/** What a log line may say about a failed token query: never the driver's message, statement or params. */
export function tokenErrorFields({ name, operation, code, causeName }: TokenStoreError) {
  return { name, operation, code, causeName }
}

const ERROR_CODE = /^[A-Z0-9_]{3,40}$/
const CLASS_NAME = /^[A-Za-z0-9_]{1,40}$/

function describe(error: unknown): { code?: string; causeName?: string } {
  let code: string | undefined
  let innermost: unknown = error
  for (let depth = 0; depth < 4 && innermost && typeof innermost === "object"; depth++) {
    const candidate = (innermost as { code?: unknown }).code
    if (code === undefined && typeof candidate === "string" && ERROR_CODE.test(candidate)) code = candidate
    const next = (innermost as { cause?: unknown }).cause
    if (!next || typeof next !== "object") break
    innermost = next
  }
  const name = (innermost as { constructor?: { name?: unknown } } | null)?.constructor?.name
  return { code, causeName: typeof name === "string" && CLASS_NAME.test(name) ? name : undefined }
}

export async function guardTokenDb<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const { code, causeName } = describe(error)
    throw new TokenStoreError(operation, code, causeName)
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
      const { code, causeName } = describe(error)
      console.error("[tokens] lastUsedAt failed", tokenErrorFields(new TokenStoreError("touch", code, causeName)))
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
