import type { ExtensionSettings } from "@skiffr/common"
import type { AppRouterClient } from "@skiffr/orpc/client"

export const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000
const KEY = "lastHeartbeat"

type StorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

interface Deps {
  settings: () => Promise<ExtensionSettings>
  call: <T>(run: (client: AppRouterClient) => Promise<T>) => Promise<T>
  /** Survives a worker restart but not a browser restart, which is when the next beat is wanted anyway. */
  area: StorageArea
  now?: () => number
  intervalMs?: number
}

/**
 * A cheap `extension.whoami` so the dashboard sees the extension even on a day without a fill. The client header on the
 * call carries the version. At most once per interval, only with a token, and any failure is dropped: a beat never blocks
 * or breaks a fill, and nothing from a page is sent.
 */
export function createHeartbeat({ settings, call, area, now = Date.now, intervalMs = HEARTBEAT_INTERVAL_MS }: Deps) {
  let running = false
  return async function beat(): Promise<void> {
    if (running) return
    running = true
    try {
      if (!(await settings()).token) return
      const last = (await area.get(KEY))[KEY]
      const at = now()
      if (typeof last === "number" && at - last < intervalMs && at >= last) return
      await area.set({ [KEY]: at })
      await call((client) => client.extension.whoami())
    } catch {
      // best effort: an offline api or a revoked token shows up on the next real call
    } finally {
      running = false
    }
  }
}
