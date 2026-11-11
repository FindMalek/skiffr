import { GMAIL_LABEL, GMAIL_SCOPE } from "@skiffr/common/constants"
import { type Db, gmailAccount } from "@skiffr/db"
import { and, eq, isNull, lt, or } from "drizzle-orm"
import { describeError } from "../errors"
import { open, seal } from "./crypto"
import { GoogleError } from "./errors"
import { ensureLabel, exchangeCode, type GmailRuntime, gmail, revokeToken } from "./google"
import { DEFAULT_SENDERS } from "./senders"
import { MANUAL_SYNC_GAP_MS, type SyncDeps, type SyncSummary, syncAccount } from "./sync"

/** Codes the callback puts in the redirect, so the page can say what happened without carrying anything from Google. */
export const CONNECT_REASONS = [
  "connected",
  "denied",
  "invalid_state",
  "exchange_failed",
  "no_refresh_token",
  "scope_missing",
  "already_connected",
  "not_configured",
  "google_error",
] as const
export type ConnectReason = (typeof CONNECT_REASONS)[number]

const hasScope = (granted: string | undefined) => (granted ?? "").split(/\s+/).includes(GMAIL_SCOPE)

/**
 * Finishes the consent: exchanges the code (with the PKCE verifier), checks the grant covers `gmail.modify`, reads the
 * mailbox's address, makes the `skiffr/jobs` label and stores the refresh token sealed. A grant that can't be used is
 * revoked again, so nothing is left behind at Google.
 */
export async function completeConnect(
  db: Db,
  runtime: GmailRuntime,
  input: { userId: string; code: string; verifier: string; now: Date },
): Promise<ConnectReason> {
  let tokens: Awaited<ReturnType<typeof exchangeCode>>
  try {
    tokens = await exchangeCode(runtime, input.code, input.verifier)
  } catch {
    return "exchange_failed"
  }
  const undo = async (reason: ConnectReason) => {
    await revokeToken(runtime, tokens.refresh_token ?? tokens.access_token)
    return reason
  }
  if (!tokens.refresh_token) return undo("no_refresh_token")
  if (!hasScope(tokens.scope)) return undo("scope_missing")

  let email: string
  let labelId: string
  try {
    const api = gmail(runtime, tokens.access_token)
    email = await api.getProfile()
    labelId = await ensureLabel(api, GMAIL_LABEL)
  } catch (error) {
    return undo(error instanceof GoogleError && error.kind === "scope" ? "scope_missing" : "google_error")
  }

  try {
    const replaced = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(gmailAccount).where(eq(gmailAccount.userId, input.userId)).for("update")
      const values = {
        email,
        refreshTokenEnc: seal(runtime.key, tokens.refresh_token!, input.userId),
        scopes: tokens.scope ?? GMAIL_SCOPE,
        status: "active" as const,
        labelId,
        lastError: null,
        nextAttemptAt: null,
        leaseUntil: null,
        updatedAt: input.now,
      }
      if (existing && existing.email === email) {
        await tx.update(gmailAccount).set(values).where(eq(gmailAccount.id, existing.id))
        return null
      }
      // A different mailbox than before replaces the old connection and what was recorded for it.
      if (existing) await tx.delete(gmailAccount).where(eq(gmailAccount.id, existing.id))
      await tx.insert(gmailAccount).values({ ...values, userId: input.userId, senders: [...DEFAULT_SENDERS] })
      return existing ?? null
    })
    if (replaced) {
      try {
        await revokeToken(runtime, open(runtime.key, replaced.refreshTokenEnc, input.userId))
      } catch {}
    }
    return "connected"
  } catch (error) {
    // The mailbox belongs to another skiffr user: unique on the address.
    const taken = describeError(error).code === "23505"
    return undo(taken ? "already_connected" : "google_error")
  }
}

/** Revokes the grant at Google (best effort) and deletes the connection with everything recorded for it. Queued jobs stay. */
export async function disconnect(
  db: Db,
  runtime: GmailRuntime | null,
  userId: string,
): Promise<{ revoked: boolean } | null> {
  const [account] = await db.select().from(gmailAccount).where(eq(gmailAccount.userId, userId))
  if (!account) return null
  let revoked = false
  if (runtime) {
    try {
      revoked = await revokeToken(runtime, open(runtime.key, account.refreshTokenEnc, userId))
    } catch {}
  }
  await db.delete(gmailAccount).where(eq(gmailAccount.id, account.id))
  return { revoked }
}

/** A manual sync, at most one a minute per account: the claim is one atomic update, so two clicks don't both pass. */
export async function syncNow(deps: SyncDeps, userId: string): Promise<SyncSummary | "too_soon" | "not_connected"> {
  const now = deps.now()
  const [account] = await deps.db
    .select({ id: gmailAccount.id })
    .from(gmailAccount)
    .where(eq(gmailAccount.userId, userId))
  if (!account) return "not_connected"
  const [claimed] = await deps.db
    .update(gmailAccount)
    .set({ lastManualSyncAt: now })
    .where(
      and(
        eq(gmailAccount.id, account.id),
        or(
          isNull(gmailAccount.lastManualSyncAt),
          lt(gmailAccount.lastManualSyncAt, new Date(now.getTime() - MANUAL_SYNC_GAP_MS)),
        ),
      ),
    )
    .returning({ id: gmailAccount.id })
  if (!claimed) return "too_soon"
  return syncAccount(deps, account.id)
}
