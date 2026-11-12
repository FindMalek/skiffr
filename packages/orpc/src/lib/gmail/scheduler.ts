import { logSyncFailure } from "./errors"
import type { Leader } from "./leader"
import { type SyncDeps, syncDue } from "./sync"

export interface Scheduler {
  /** One pass: runs the due mailboxes if this process leads, returns how many it ran. */
  tick(): Promise<number>
  start(): void
  /** Stops scheduling, lets the mailbox in progress finish, and gives up the lead. */
  stop(): Promise<void>
}

const JITTER = 0.2

export interface LoopOptions {
  leader: Leader
  intervalMs: number
  random?: () => number
  onError?: (error: unknown) => void
}

/** The mailboxes' schedule. */
export const createScheduler = (deps: SyncDeps, options: LoopOptions): Scheduler =>
  createLoop(async (stopped) => (await syncDue(deps, stopped)).length, {
    onError: (error) => logSyncFailure("scheduler", error),
    ...options,
  })

/**
 * The in-process schedule, shared by every background connector: `work` runs every interval, plus or minus a fifth so
 * replicas and restarts don't line up, and only on the replica that leads.
 */
export function createLoop(work: (stopped: () => boolean) => Promise<number>, options: LoopOptions): Scheduler {
  const random = options.random ?? Math.random
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<number> | null = null

  const run = async (): Promise<number> => {
    try {
      if (stopped || !(await options.leader.tryAcquire())) return 0
      return await work(() => stopped)
    } catch (error) {
      options.onError?.(error)
      return 0
    }
  }

  const tick = () => {
    running = run().finally(() => {
      running = null
    })
    return running
  }

  const schedule = (delay: number) => {
    timer = setTimeout(async () => {
      await tick()
      if (!stopped) schedule(options.intervalMs * (1 - JITTER + 2 * JITTER * random()))
    }, delay)
    timer.unref?.()
  }

  return {
    tick,
    start() {
      // The first pass waits a little, so a restart loop doesn't fetch on every boot.
      if (!timer && !stopped) schedule(Math.min(options.intervalMs, 30_000) * (0.5 + random()))
    },
    async stop() {
      stopped = true
      clearTimeout(timer)
      timer = undefined
      await running
      await options.leader.release()
    },
  }
}
