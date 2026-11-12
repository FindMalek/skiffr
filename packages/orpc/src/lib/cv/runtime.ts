import { parseKey } from "../gmail/crypto"
import { systemTransport } from "../watch/guard"
import { HostGate, UserBudget } from "../watch/limits"
import type { CvRuntime } from "./client"

export const HOST_GAP_MS = 250
export const TAILORS_PER_HOUR = 20

/** The real network, a quarter second between calls to one instance and twenty tailoring runs an hour per user. */
export function createCvRuntime(options: { encryptionKey: string }): CvRuntime {
  return {
    key: parseKey(options.encryptionKey, "CV_ENCRYPTION_KEY"),
    guard: { transport: systemTransport, gate: new HostGate(HOST_GAP_MS) },
    budget: new UserBudget(TAILORS_PER_HOUR, 60 * 60 * 1000),
  }
}
