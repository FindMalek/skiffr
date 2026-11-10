import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ExtensionSettings } from "@skiffr/common"
import type { AppRouterClient } from "@skiffr/orpc/client"
import { getSettings } from "./storage"

export class NotConfiguredError extends Error {
  constructor() {
    super("No token set")
  }
}

export function createApiClient(settings: ExtensionSettings): AppRouterClient {
  const link = new RPCLink({
    url: `${settings.apiUrl}/rpc`,
    headers: { authorization: `Bearer ${settings.token}` },
  })
  return createORPCClient<AppRouterClient>(link)
}

/**
 * Background worker only: reads the token from storage, calls the api with it and hands back the result. The token
 * never leaves the worker, content scripts ask the worker for what they need.
 */
export async function apiFetch<T>(call: (client: AppRouterClient) => Promise<T>): Promise<T> {
  const settings = await getSettings()
  if (!settings.token) throw new NotConfiguredError()
  return call(createApiClient(settings))
}
