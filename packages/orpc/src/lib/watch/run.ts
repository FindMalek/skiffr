import { canonicalizeJob } from "@skiffr/common/utils"
import { type Db, jobSource } from "@skiffr/db"
import { and, asc, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { queueJob } from "../jobs"
import { FetchError, logWatchFailure, type WatchError, watchErrorOf } from "./errors"
import type { GuardDeps } from "./guard"
import type { HostGate, UserBudget } from "./limits"
import { readSource } from "./read"

type Source = typeof jobSource.$inferSelect

export interface WatchRuntime {
  guard: Omit<GuardDeps, "gate">
  gate: HostGate
  budget: UserBudget
  /** How long a source waits between fetches when all goes well. */
  refreshMinutes: number
}

export interface WatchDeps {
  db: Db
  runtime: WatchRuntime
  now: () => Date
}

export interface RunSummary {
  state: "done" | "busy" | "stopped"
  error?: WatchError
  found: number
  added: number
}

const LEASE_MS = 2 * 60 * 1000
export const MANUAL_RUN_GAP_MS = 60 * 1000
const MANUAL_WINDOW_MS = 10 * 60 * 1000
export const MANUAL_PER_USER_MAX = 6
/** New jobs queued per fetch: the rest of a long board follows on the next ones, and a hostile feed can't flood the queue in one go. */
export const ADDED_PER_RUN_MAX = 100
export const SEEN_MAX = 2_000
const DUE_MAX = 100
const BACKOFF_CAP_MS = 24 * 60 * 60 * 1000
const BLOCKED_WAIT_MS = 24 * 60 * 60 * 1000

const summary = (state: RunSummary["state"], extra: Partial<RunSummary> = {}): RunSummary => ({
  state,
  found: 0,
  added: 0,
  ...extra,
})

/** The first writer of the lease wins: disabled sources are never claimed, so they are never fetched. */
async function claimLease(deps: WatchDeps, id: string): Promise<Source | undefined> {
  const now = deps.now()
  const [claimed] = await deps.db
    .update(jobSource)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(jobSource.id, id),
        eq(jobSource.enabled, true),
        or(isNull(jobSource.leaseUntil), lt(jobSource.leaseUntil, now)),
      ),
    )
    .returning()
  return claimed
}

const labelOf = (source: Source) => source.label || new URL(source.url).hostname.replace(/^www\./, "")

function backoff(source: Source, deps: WatchDeps, error: unknown): number {
  const base = deps.runtime.refreshMinutes * 60_000
  const code = watchErrorOf(error)
  if (code === "blocked") return BLOCKED_WAIT_MS
  const exponential = Math.min(BACKOFF_CAP_MS, base * 2 ** Math.min(source.failures, 6))
  return error instanceof FetchError && error.retryAfterMs
    ? Math.min(BACKOFF_CAP_MS, Math.max(exponential, error.retryAfterMs))
    : exponential
}

/** The posting ids already queued from this source stay in the list, so a job the user deleted is not queued again. */
async function fetchAndStore(deps: WatchDeps, source: Source): Promise<RunSummary> {
  const read = await readSource({ ...deps.runtime.guard, gate: deps.runtime.gate }, source)
  const now = deps.now()
  const next = new Date(now.getTime() + deps.runtime.refreshMinutes * 60_000)
  if (!read.changed) {
    await deps.db
      .update(jobSource)
      .set({
        status: "ok",
        lastError: null,
        failures: 0,
        lastCheckedAt: now,
        nextAttemptAt: next,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(eq(jobSource.id, source.id))
    return summary("done", { found: source.lastFound })
  }
  const seen = new Set(source.seenIds)
  const fresh = read.postings
    .map((posting) => ({ posting, id: canonicalizeJob(posting.url).canonicalId }))
    .filter(({ id }, index, all) => !seen.has(id) && all.findIndex((other) => other.id === id) === index)
    .slice(0, ADDED_PER_RUN_MAX)
  const label = `watch:${labelOf(source)}`
  const added = await deps.db.transaction(async (tx) => {
    let created = 0
    for (const { posting } of fresh) {
      const queued = await queueJob(tx, source.userId, { ...posting, source: label }, now)
      if (queued.created) created++
    }
    await tx
      .update(jobSource)
      .set({
        kind: read.kind,
        status: "ok",
        lastError: null,
        failures: 0,
        lastCheckedAt: now,
        nextAttemptAt: next,
        leaseUntil: null,
        etag: read.etag,
        lastModified: read.lastModified,
        lastFound: read.postings.length,
        lastAdded: created,
        seenIds: [...source.seenIds, ...fresh.map(({ id }) => id)].slice(-SEEN_MAX),
        updatedAt: now,
      })
      .where(eq(jobSource.id, source.id))
    return created
  })
  return summary("done", { found: read.postings.length, added })
}

async function recordFailure(deps: WatchDeps, source: Source, error: unknown): Promise<WatchError> {
  const code = watchErrorOf(error)
  const now = deps.now()
  await deps.db
    .update(jobSource)
    .set({
      status: "error",
      lastError: code,
      failures: source.failures + 1,
      lastCheckedAt: now,
      nextAttemptAt: new Date(now.getTime() + backoff(source, deps, error)),
      leaseUntil: null,
      updatedAt: now,
    })
    .where(eq(jobSource.id, source.id))
  logWatchFailure(source.id, error, { step: "fetch" })
  return code
}

/** One fetch of one source. The lease keeps a click and the schedule (or two replicas) from fetching it at once. */
export async function runSource(deps: WatchDeps, id: string): Promise<RunSummary> {
  const source = await claimLease(deps, id)
  if (!source) return summary("busy")
  if (!deps.runtime.budget.take(source.userId, deps.now())) {
    await deps.db.update(jobSource).set({ leaseUntil: null }).where(eq(jobSource.id, id))
    return summary("stopped", { error: "rate_limited" })
  }
  try {
    return await fetchAndStore(deps, source)
  } catch (error) {
    const code = await recordFailure(deps, source, error).catch(() => watchErrorOf(error))
    return summary("stopped", { error: code })
  }
}

/** Enabled sources whose wait is over and that nobody is fetching, the longest unchecked first. */
export async function dueSourceIds(deps: WatchDeps): Promise<string[]> {
  const now = deps.now()
  const rows = await deps.db
    .select({ id: jobSource.id })
    .from(jobSource)
    .where(
      and(
        eq(jobSource.enabled, true),
        or(isNull(jobSource.nextAttemptAt), lt(jobSource.nextAttemptAt, now)),
        or(isNull(jobSource.leaseUntil), lt(jobSource.leaseUntil, now)),
      ),
    )
    .orderBy(sql`${jobSource.lastCheckedAt} asc nulls first`, asc(jobSource.id))
    .limit(DUE_MAX)
  return rows.map((row) => row.id)
}

/** Every due source, one after the other: a slow or failing one never holds up the rest. */
export async function runDue(deps: WatchDeps, stopped: () => boolean = () => false): Promise<RunSummary[]> {
  const results: RunSummary[] = []
  for (const id of await dueSourceIds(deps)) {
    if (stopped()) break
    results.push(await runSource(deps, id))
  }
  return results
}

export type RunNowResult = RunSummary | "not_found" | "disabled" | "too_soon" | "too_many"

/** A click on "Run now": one a minute per source and a handful per user in ten minutes. The claim is one atomic update, so two clicks don't both pass. */
export async function runNow(deps: WatchDeps, userId: string, id: string): Promise<RunNowResult> {
  const now = deps.now()
  const [source] = await deps.db
    .select({ enabled: jobSource.enabled })
    .from(jobSource)
    .where(and(eq(jobSource.userId, userId), eq(jobSource.id, id)))
  if (!source) return "not_found"
  if (!source.enabled) return "disabled"
  const [recent] = await deps.db
    .select({ n: count() })
    .from(jobSource)
    .where(and(eq(jobSource.userId, userId), gt(jobSource.lastManualRunAt, new Date(now.getTime() - MANUAL_WINDOW_MS))))
  if ((recent?.n ?? 0) >= MANUAL_PER_USER_MAX) return "too_many"
  const [claimed] = await deps.db
    .update(jobSource)
    .set({ lastManualRunAt: now })
    .where(
      and(
        eq(jobSource.id, id),
        eq(jobSource.userId, userId),
        or(
          isNull(jobSource.lastManualRunAt),
          lt(jobSource.lastManualRunAt, new Date(now.getTime() - MANUAL_RUN_GAP_MS)),
        ),
      ),
    )
    .returning({ id: jobSource.id })
  if (!claimed) return "too_soon"
  return runSource(deps, id)
}
