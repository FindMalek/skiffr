import { createHash, randomBytes } from "node:crypto"
import { type Db, gmailOauthState } from "@skiffr/db"
import { and, eq, gt, lt } from "drizzle-orm"
import { open, seal, sha256, sign, verifySignature } from "./crypto"

export const STATE_TTL_MS = 10 * 60 * 1000

/** Where the user may be sent back to: exact paths of the dashboard, never a value taken from the request as it came. */
const RETURN_PATHS: ReadonlySet<string> = new Set(["/settings/gmail"])
export const DEFAULT_RETURN = "/settings/gmail"

export const safeReturnTo = (value: string | null | undefined): string =>
  value && RETURN_PATHS.has(value) ? value : DEFAULT_RETURN

/**
 * Starts a consent flow: a random `state` signed with the user's id and its expiry, plus a PKCE verifier. The verifier and
 * a hash of the state are kept server side, so the callback works once, for the same user, within ten minutes.
 */
export async function startFlow(
  db: Db,
  key: Buffer,
  userId: string,
  returnTo: string,
  now: Date,
): Promise<{ state: string; challenge: string }> {
  const nonce = randomBytes(24).toString("base64url")
  const verifier = randomBytes(32).toString("base64url")
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS)
  const expiry = Math.floor(expiresAt.getTime() / 1000)
  await db.transaction(async (tx) => {
    // Latest wins: one flow in progress per user, and old ones don't pile up.
    await tx.delete(gmailOauthState).where(eq(gmailOauthState.userId, userId))
    await tx.delete(gmailOauthState).where(lt(gmailOauthState.expiresAt, now))
    await tx.insert(gmailOauthState).values({
      userId,
      stateHash: sha256(nonce),
      codeVerifierEnc: seal(key, verifier, userId),
      returnTo: safeReturnTo(returnTo),
      expiresAt,
    })
  })
  return {
    state: `${nonce}.${expiry}.${sign(key, `${nonce}.${expiry}.${userId}`)}`,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  }
}

/** Null unless `state` is ours, unexpired, made for this user and not used before. Using it deletes it. */
export async function consumeFlow(
  db: Db,
  key: Buffer,
  state: string,
  userId: string,
  now: Date,
): Promise<{ verifier: string; returnTo: string } | null> {
  const [nonce, expiry, signature, ...rest] = state.split(".")
  if (!nonce || !expiry || !signature || rest.length > 0 || !/^\d{1,12}$/.test(expiry)) return null
  if (!verifySignature(key, `${nonce}.${expiry}.${userId}`, signature)) return null
  if (Number(expiry) * 1000 <= now.getTime()) return null
  const [row] = await db
    .delete(gmailOauthState)
    .where(
      and(
        eq(gmailOauthState.stateHash, sha256(nonce)),
        eq(gmailOauthState.userId, userId),
        gt(gmailOauthState.expiresAt, now),
      ),
    )
    .returning()
  if (!row) return null
  try {
    return { verifier: open(key, row.codeVerifierEnc, userId), returnTo: safeReturnTo(row.returnTo) }
  } catch {
    return null
  }
}
