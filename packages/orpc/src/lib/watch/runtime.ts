import { systemTransport } from "./guard"
import { HostGate, UserBudget } from "./limits"
import type { WatchRuntime } from "./run"

export const HOST_GAP_MS = 1_000
export const USER_FETCHES_PER_HOUR = 60

/** The real network, a second between requests to one host and sixty fetches an hour per user. */
export function createWatchRuntime(options: { refreshMinutes: number }): WatchRuntime {
  return {
    guard: { transport: systemTransport },
    gate: new HostGate(HOST_GAP_MS),
    budget: new UserBudget(USER_FETCHES_PER_HOUR, 60 * 60 * 1000),
    refreshMinutes: options.refreshMinutes,
  }
}
