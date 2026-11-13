import { ORPCError } from "@orpc/client"
import type { ExtensionSettings } from "@skiffr/common"
import { isOlderVersion } from "@skiffr/common/utils"
import { apiFetch, NotConfiguredError } from "./api"
import { CLIENT_INFO } from "./client"

export { isTestConnectionMessage, type TestConnectionMessage } from "./messages"

export type ConnectionResult =
  | { ok: true; name: string; updateNeeded: boolean }
  | { ok: false; reason: "missing-token" | "rejected" | "unavailable" | "unreachable" }

/** What the options page says for each failure. */
export const CONNECTION_TEXT = {
  "missing-token": "Add a token first. Create one in the dashboard under Extension.",
  rejected: "The token was rejected. It may be revoked or expired: create a new one in the dashboard under Extension.",
  unavailable: "The API had a problem. Your token may be fine, try again in a moment.",
  unreachable: "Could not reach the API. Check the API url.",
} as const

export const UPDATE_NEEDED_TEXT = "This extension is older than your API supports. Update it to keep filling."

/** Asks the api who the saved token belongs to. The result never carries the token or the api's error text. */
export async function testConnection(
  load?: () => Promise<ExtensionSettings>,
  fetch?: typeof globalThis.fetch,
): Promise<ConnectionResult> {
  try {
    const who = await apiFetch((client) => client.extension.whoami(), load, fetch)
    return {
      ok: true,
      name: who.user.name,
      updateNeeded: isOlderVersion(CLIENT_INFO.clientVersion, who.minExtensionVersion),
    }
  } catch (error) {
    if (error instanceof NotConfiguredError) return { ok: false, reason: "missing-token" }
    if (error instanceof ORPCError) {
      if (error.status === 401 || error.status === 403) return { ok: false, reason: "rejected" }
      if (error.status >= 500) return { ok: false, reason: "unavailable" }
    }
    return { ok: false, reason: "unreachable" }
  }
}
