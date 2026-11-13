import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ExtensionSettings } from "@skiffr/common"
import { CLIENT_HEADER } from "@skiffr/common/utils"
import type { AppRouterClient } from "@skiffr/orpc/client"
import { CLIENT_HEADER_VALUE } from "./client"
import { getSettings } from "./storage"

export class NotConfiguredError extends Error {
  constructor() {
    super("No token set")
  }
}

export function createApiClient(settings: ExtensionSettings, fetch?: typeof globalThis.fetch): AppRouterClient {
  const link = new RPCLink({
    url: `${settings.apiUrl}/rpc`,
    headers: { authorization: `Bearer ${settings.token}`, [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    fetch,
  })
  return createORPCClient<AppRouterClient>(link)
}

/**
 * Background worker only: reads the token from storage, calls the api with it and hands back the result. The token
 * never leaves the worker, content scripts ask the worker for what they need.
 */
export async function apiFetch<T>(
  call: (client: AppRouterClient) => Promise<T>,
  load: () => Promise<ExtensionSettings> = getSettings,
  fetch?: typeof globalThis.fetch,
): Promise<T> {
  const settings = await load()
  if (!settings.token) throw new NotConfiguredError()
  return call(createApiClient(settings, fetch))
}
