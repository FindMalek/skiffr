import { ORPCError } from "@orpc/client"
import { apiFetch, NotConfiguredError } from "./api"

export type TestConnectionMessage = { type: "test-connection" }

export type ConnectionResult =
  | { ok: true; name: string }
  | { ok: false; reason: "missing-token" | "rejected" | "unreachable" }

export function isTestConnectionMessage(value: unknown): value is TestConnectionMessage {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "test-connection"
}

/** Asks the api who the saved token belongs to. The result never carries the token or the api's error text. */
export async function testConnection(): Promise<ConnectionResult> {
  try {
    const who = await apiFetch((client) => client.extension.whoami())
    return { ok: true, name: who.user.name }
  } catch (error) {
    if (error instanceof NotConfiguredError) return { ok: false, reason: "missing-token" }
    if (error instanceof ORPCError && (error.status === 401 || error.status === 403)) {
      return { ok: false, reason: "rejected" }
    }
    return { ok: false, reason: "unreachable" }
  }
}
