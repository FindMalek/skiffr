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

/** The in-process schedule: every interval, plus or minus a fifth so replicas and restarts don't line up. */
export function createScheduler(
  deps: SyncDeps,
  options: { leader: Leader; intervalMs: number; random?: () => number },
): Scheduler {
  const random = options.random ?? Math.random
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<number> | null = null

  const run = async (): Promise<number> => {
    try {
      if (stopped || !(await options.leader.tryAcquire())) return 0
      return (await syncDue(deps, () => stopped)).length
    } catch (error) {
      logSyncFailure("scheduler", error)
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
      // The first pass waits a little, so a restart loop doesn't read mail on every boot.
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
