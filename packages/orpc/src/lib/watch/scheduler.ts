import { createLoop, type LoopOptions, type Scheduler } from "../gmail/scheduler"
import { logWatchFailure } from "./errors"
import { runDue, type WatchDeps } from "./run"

/** The sources' schedule: the same in-process loop the mailboxes use, with its own lock so the two don't share a leader. */
export const createWatchScheduler = (deps: WatchDeps, options: LoopOptions): Scheduler =>
  createLoop(async (stopped) => (await runDue(deps, stopped)).length, {
    onError: (error) => logWatchFailure("scheduler", error),
    ...options,
  })
