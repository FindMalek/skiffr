import type { Observability } from "./observability"

/**
 * Reports an uncaught exception and then still crashes with exit code 1. A fire and forget report would be lost, because
 * the process is gone before the request leaves, so the flush is awaited, for `waitMs` at most.
 */
export function reportCrashes(observability: Observability, context: Record<string, unknown>, waitMs = 1500): void {
  let crashing = false
  process.on("uncaughtException", (error) => {
    console.error(error)
    if (crashing) return
    crashing = true
    observability.captureError(error, context)
    const cap = new Promise<void>((resolve) => setTimeout(resolve, waitMs))
    void Promise.race([observability.flush().catch(() => undefined), cap]).then(() => process.exit(1))
  })
}
