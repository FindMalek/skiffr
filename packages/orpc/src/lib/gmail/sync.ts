import { GMAIL_LABEL } from "@skiffr/common/constants"
import { type Db, gmailAccount, gmailMessage, gmailMessageJob, job } from "@skiffr/db"
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm"
import { CryptoError, open } from "./crypto"
import { GoogleError, logSyncFailure, type SyncError, syncErrorOf } from "./errors"
import { ensureLabel, type GmailApi, type GmailRuntime, gmail, refreshAccessToken } from "./google"
import { failedAuthentication, readMessage } from "./mime"
import { parseEmail } from "./parsers"
import { buildQuery, fromAddress, isWatched, providerOf } from "./senders"

type Account = typeof gmailAccount.$inferSelect

export const LIST_MAX = 200
export const PROCESS_MAX = 50
const PAGE_SIZE = 100
const RETRIES = 2
const RETRY_BASE_MS = 1_000
const RETRY_CAP_MS = 30_000
const LEASE_MS = 10 * 60 * 1000
const BUDGET_MS = 4 * 60 * 1000
const TOKEN_TTL_MS = 5 * 60 * 1000
const MESSAGE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000
const BACKOFF_MS = { rate: 10 * 60 * 1000, other: 5 * 60 * 1000 }
export const MANUAL_SYNC_GAP_MS = 60 * 1000

/** Access tokens live here only, and only briefly: a restart just means one more refresh. */
export class TokenCache {
  private entries = new Map<string, { token: string; until: number }>()
  get(accountId: string, now: Date): string | undefined {
    const entry = this.entries.get(accountId)
    if (entry && entry.until > now.getTime()) return entry.token
    this.entries.delete(accountId)
    return undefined
  }
  set(accountId: string, token: string, expiresInSeconds: number, now: Date) {
    const ttl = Math.min(TOKEN_TTL_MS, Math.max(0, expiresInSeconds * 1000 - 60_000))
    this.entries.set(accountId, { token, until: now.getTime() + ttl })
  }
  delete(accountId: string) {
    this.entries.delete(accountId)
  }
}

export interface SyncDeps {
  db: Db
  runtime: GmailRuntime
  now: () => Date
  tokens: TokenCache
}

export interface SyncSummary {
  /** `busy` means another run holds the mailbox, `inactive` that it needs reconnecting or is disabled. */
  state: "done" | "busy" | "inactive" | "stopped"
  error?: SyncError
  imported: number
  duplicates: number
  noJobs: number
  skipped: number
  failed: number
  jobsAdded: number
  tidied: number
}

const emptySummary = (state: SyncSummary["state"]): SyncSummary => ({
  state,
  imported: 0,
  duplicates: 0,
  noJobs: 0,
  skipped: 0,
  failed: 0,
  jobsAdded: 0,
  tidied: 0,
})

/** A rate limit or a server error is retried a couple of times with backoff, then the run stops and resumes next time. */
async function guarded<T>(runtime: GmailRuntime, task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      const retryable = error instanceof GoogleError && (error.kind === "rate" || error.kind === "server")
      if (!retryable || attempt >= RETRIES) throw error
      const wait = Math.min(RETRY_CAP_MS, error.retryAfterMs ?? RETRY_BASE_MS * 2 ** attempt)
      await runtime.sleep(wait)
    }
  }
}

async function accessToken(deps: SyncDeps, account: Account): Promise<string> {
  const cached = deps.tokens.get(account.id, deps.now())
  if (cached) return cached
  let refreshToken: string
  try {
    refreshToken = open(deps.runtime.key, account.refreshTokenEnc, account.userId)
  } catch (error) {
    // A key that no longer opens the token is as good as a revoked grant: connecting again fixes it.
    if (error instanceof CryptoError) throw new GoogleError("auth")
    throw error
  }
  const fresh = await guarded(deps.runtime, () => refreshAccessToken(deps.runtime, refreshToken))
  deps.tokens.set(account.id, fresh.access_token, fresh.expires_in, deps.now())
  return fresh.access_token
}

async function claimLease(deps: SyncDeps, accountId: string): Promise<Account | undefined> {
  const now = deps.now()
  const [claimed] = await deps.db
    .update(gmailAccount)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(gmailAccount.id, accountId),
        eq(gmailAccount.status, "active"),
        or(isNull(gmailAccount.leaseUntil), lt(gmailAccount.leaseUntil, now)),
      ),
    )
    .returning()
  return claimed
}

interface Tidy {
  api: GmailApi
  labelId: string
}

/** Marks the email read, takes it out of the inbox and labels it. Never deletes or trashes. */
async function tidy({ api, labelId }: Tidy, googleMessageId: string) {
  await api.modifyMessage(googleMessageId, { add: [labelId], remove: ["UNREAD", "INBOX"] })
}

/**
 * Tidies one stored email and records it. Auth, scope, rate and server trouble stop the run (the caller's catch); a
 * refusal of this one email is logged and the next run tries again, except for an email that is gone (404): nothing is left to tidy.
 */
async function tidyAndRecord(
  deps: SyncDeps,
  accountId: string,
  target: Tidy,
  row: { id: string; googleMessageId: string },
): Promise<boolean> {
  try {
    await guarded(deps.runtime, () => tidy(target, row.googleMessageId))
  } catch (error) {
    if (!(error instanceof GoogleError) || error.kind !== "client") throw error
    logSyncFailure(accountId, error, { step: "tidy" })
    if (error.status !== 404) return false
  }
  await deps.db.update(gmailMessage).set({ modifiedAt: deps.now() }).where(eq(gmailMessage.id, row.id))
  return true
}

type Outcome = "imported" | "duplicate" | "no_jobs" | "skipped" | "failed"

interface Stored {
  messageId: string
  outcome: Outcome
  added: number
}

/**
 * One transaction per email: the message row, its new jobs and their links commit together or not at all. The message row
 * goes first and is unique per user, so a run racing this one finds it taken and does nothing.
 */
async function store(
  deps: SyncDeps,
  account: Account,
  googleMessageId: string,
  provider: string,
  outcome: Outcome,
  candidates: ReturnType<typeof parseEmail>,
): Promise<Stored | null> {
  const now = deps.now()
  return deps.db.transaction(async (tx) => {
    const [message] = await tx
      .insert(gmailMessage)
      .values({
        userId: account.userId,
        accountId: account.id,
        googleMessageId,
        provider,
        outcome,
        jobsFound: candidates.length,
        processedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: gmailMessage.id })
    if (!message) return null

    const source = `gmail:${provider}`
    const added: string[] = []
    for (const candidate of candidates) {
      // The same posting seen by another board's alert (same title and company) is not queued twice.
      const [twin] = await tx
        .select({ id: job.id })
        .from(job)
        .where(
          and(
            eq(job.userId, account.userId),
            sql`lower(${job.title}) = ${candidate.title.toLowerCase()}`,
            sql`lower(${job.company}) = ${candidate.company.toLowerCase()}`,
            sql`${job.source} like 'gmail:%'`,
            ne(job.source, source),
          ),
        )
        .limit(1)
      if (twin) continue
      const [created] = await tx
        .insert(job)
        .values({
          userId: account.userId,
          url: candidate.url,
          canonicalId: candidate.canonicalId,
          title: candidate.title,
          company: candidate.company,
          source,
          queuedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: job.id })
      if (created) added.push(created.id)
    }
    if (added.length > 0) {
      await tx.insert(gmailMessageJob).values(added.map((jobId) => ({ messageId: message.id, jobId })))
    }
    const final: Outcome = candidates.length === 0 ? outcome : added.length > 0 ? "imported" : "duplicate"
    await tx.update(gmailMessage).set({ outcome: final, jobsNew: added.length }).where(eq(gmailMessage.id, message.id))
    return { messageId: message.id, outcome: final, added: added.length }
  })
}

async function readOne(
  deps: SyncDeps,
  account: Account,
  api: GmailApi,
  googleMessageId: string,
): Promise<{ provider: string; outcome: Outcome; candidates: ReturnType<typeof parseEmail> }> {
  let message: Awaited<ReturnType<GmailApi["getMessage"]>>
  try {
    message = await guarded(deps.runtime, () => api.getMessage(googleMessageId))
  } catch (error) {
    // Too big to read, or gone since the listing: remembered as skipped so it is not asked for again.
    if (error instanceof GoogleError && (error.kind === "too_large" || error.kind === "client"))
      return { provider: "other", outcome: "skipped", candidates: [] }
    throw error
  }
  const read = readMessage(message)
  const address = read.from ? fromAddress(read.from) : null
  if (!address || !isWatched(address, account.senders) || failedAuthentication(read.authentication)) {
    return { provider: "other", outcome: "skipped", candidates: [] }
  }
  const provider = providerOf(address)
  try {
    const candidates = parseEmail(provider, { html: read.html, text: read.text })
    return { provider, outcome: "no_jobs", candidates }
  } catch {
    return { provider, outcome: "failed", candidates: [] }
  }
}

async function recordStop(deps: SyncDeps, account: Account, error: unknown): Promise<SyncError> {
  const code = syncErrorOf(error)
  const now = deps.now()
  const needsReconnect = code === "auth" || code === "scope"
  const wait =
    error instanceof GoogleError && error.kind === "rate"
      ? Math.max(BACKOFF_MS.rate, error.retryAfterMs ?? 0)
      : BACKOFF_MS.other
  if (needsReconnect) deps.tokens.delete(account.id)
  await deps.db
    .update(gmailAccount)
    .set({
      lastError: code,
      leaseUntil: null,
      updatedAt: now,
      ...(needsReconnect
        ? { status: "needs_reconnect" as const, nextAttemptAt: null }
        : { nextAttemptAt: new Date(now.getTime() + wait) }),
    })
    .where(eq(gmailAccount.id, account.id))
  logSyncFailure(account.id, error)
  return code
}

/**
 * One pass over one mailbox. Unread inbox mail from the watched senders is read, its jobs are queued, and only after
 * that commit is the email tidied (read, out of the inbox, labelled), so a failed tidy repeats on the next run without
 * duplicating anything. Mail with no job in it is left exactly where it is.
 */
export async function syncAccount(deps: SyncDeps, accountId: string): Promise<SyncSummary> {
  const claimed = await claimLease(deps, accountId)
  if (!claimed) {
    const [current] = await deps.db
      .select({ status: gmailAccount.status })
      .from(gmailAccount)
      .where(eq(gmailAccount.id, accountId))
    return emptySummary(current && current.status !== "active" ? "inactive" : "busy")
  }
  let account = claimed
  const summary = emptySummary("done")
  const started = deps.now().getTime()
  try {
    const api = gmail(deps.runtime, await accessToken(deps, account))
    const labelId = await guarded(deps.runtime, () => ensureLabel(api, GMAIL_LABEL))
    if (labelId !== account.labelId) {
      await deps.db.update(gmailAccount).set({ labelId }).where(eq(gmailAccount.id, account.id))
      account = { ...account, labelId }
    }
    const tidyWith: Tidy = { api, labelId }

    const ids: string[] = []
    if (account.senders.length > 0) {
      const query = buildQuery(account.senders)
      let page: string | undefined
      do {
        const listed = await guarded(deps.runtime, () =>
          api.listMessages(query, page, Math.min(PAGE_SIZE, LIST_MAX - ids.length)),
        )
        ids.push(...listed.messages.map((m) => m.id))
        page = listed.nextPageToken
      } while (page && ids.length < LIST_MAX)
    }

    const known = new Map(
      ids.length === 0
        ? []
        : (
            await deps.db
              .select({
                id: gmailMessage.id,
                googleMessageId: gmailMessage.googleMessageId,
                outcome: gmailMessage.outcome,
                modifiedAt: gmailMessage.modifiedAt,
              })
              .from(gmailMessage)
              .where(and(eq(gmailMessage.userId, account.userId), inArray(gmailMessage.googleMessageId, ids)))
          ).map((row) => [row.googleMessageId, row]),
    )

    let handled = 0
    for (const id of ids) {
      if (handled >= PROCESS_MAX || deps.now().getTime() - started > BUDGET_MS) break
      const previous = known.get(id)
      if (previous) {
        // Committed on an earlier run but never tidied: only the tidy is repeated.
        if (previous.modifiedAt === null && (previous.outcome === "imported" || previous.outcome === "duplicate")) {
          handled++
          if (await tidyAndRecord(deps, account.id, tidyWith, { id: previous.id, googleMessageId: id }))
            summary.tidied++
        }
        continue
      }
      handled++
      let read: Awaited<ReturnType<typeof readOne>>
      try {
        read = await readOne(deps, account, api, id)
      } catch (error) {
        if (error instanceof GoogleError) throw error
        logSyncFailure(account.id, error, { step: "read" })
        read = { provider: "other", outcome: "failed", candidates: [] }
      }
      const stored = await store(deps, account, id, read.provider, read.outcome, read.candidates)
      if (!stored) continue
      if (stored.outcome === "imported") {
        summary.imported++
        summary.jobsAdded += stored.added
      } else if (stored.outcome === "duplicate") summary.duplicates++
      else if (stored.outcome === "no_jobs") summary.noJobs++
      else if (stored.outcome === "skipped") summary.skipped++
      else summary.failed++

      if (stored.outcome === "imported" || stored.outcome === "duplicate") {
        // Not tidied yet means the jobs are safe in the queue and the next run repeats just this step.
        if (await tidyAndRecord(deps, account.id, tidyWith, { id: stored.messageId, googleMessageId: id }))
          summary.tidied++
      }
    }

    const now = deps.now()
    await deps.db
      .delete(gmailMessage)
      .where(
        and(
          eq(gmailMessage.accountId, account.id),
          lt(gmailMessage.processedAt, new Date(now.getTime() - MESSAGE_RETENTION_MS)),
        ),
      )
    await deps.db
      .update(gmailAccount)
      .set({ lastSyncAt: now, lastError: null, nextAttemptAt: null, leaseUntil: null, updatedAt: now })
      .where(eq(gmailAccount.id, account.id))
    return summary
  } catch (error) {
    const code = await recordStop(deps, account, error).catch(() => syncErrorOf(error))
    return { ...summary, state: "stopped", error: code }
  }
}

/** Active accounts whose backoff is over, oldest sync first. */
export async function dueAccountIds(deps: SyncDeps): Promise<string[]> {
  const now = deps.now()
  const rows = await deps.db
    .select({ id: gmailAccount.id })
    .from(gmailAccount)
    .where(
      and(
        eq(gmailAccount.status, "active"),
        or(isNull(gmailAccount.nextAttemptAt), lt(gmailAccount.nextAttemptAt, now)),
        or(isNull(gmailAccount.leaseUntil), lt(gmailAccount.leaseUntil, now)),
      ),
    )
    .orderBy(sql`${gmailAccount.lastSyncAt} asc nulls first`)
  return rows.map((row) => row.id)
}

/** Every due mailbox, one after the other: one slow or failing account never holds up the rest. */
export async function syncDue(deps: SyncDeps, stopped: () => boolean = () => false): Promise<SyncSummary[]> {
  const results: SyncSummary[] = []
  for (const id of await dueAccountIds(deps)) {
    if (stopped()) break
    results.push(await syncAccount(deps, id))
  }
  return results
}
