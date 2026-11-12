import { parseKey } from "../gmail/crypto"
import { systemTransport } from "../watch/guard"
import { UserBudget } from "../watch/limits"
import type { CvRuntime } from "./client"

const HOUR_MS = 60 * 60 * 1000
export const HOST_GAP_MS = 250
export const TAILORS_PER_HOUR = 20
export const COPIES_PER_HOUR = 20
export const CALLS_PER_HOUR = 120

/** The real network. Per user and an hour: 20 tailoring runs, 20 copies and 120 other calls; a quarter second between one user's calls to one instance. All counted in this process only. */
export function createCvRuntime(options: { encryptionKey: string }): CvRuntime {
  return {
    key: parseKey(options.encryptionKey, "CV_ENCRYPTION_KEY"),
    guard: { transport: systemTransport },
    budget: new UserBudget(TAILORS_PER_HOUR, HOUR_MS),
    copies: new UserBudget(COPIES_PER_HOUR, HOUR_MS),
    calls: new UserBudget(CALLS_PER_HOUR, HOUR_MS),
    gapMs: HOST_GAP_MS,
    gates: new Map(),
  }
}
