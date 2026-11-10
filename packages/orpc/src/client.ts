import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins"
import type { AppRouterClient } from "./routers"

export type { AppRouterClient }

export interface ORPCClientOptions {
  /** Full rpc url: `${API_URL}/rpc` on the server, `${origin}/api/rpc` (the Next proxy) in the browser. */
  url: string | (() => string)
  /** Server side only: forward the visitor's cookie so admin calls carry the session. */
  getHeaders?: () => Promise<Record<string, string>> | Record<string, string>
}

export function createORPCClientUtils({ url, getHeaders }: ORPCClientOptions) {
  const link = new RPCLink({
    url,
    headers: async () => (getHeaders ? await getHeaders() : {}),
    plugins: [new SimpleCsrfProtectionLinkPlugin()],
  })
  return { link, client: createORPCClient<AppRouterClient>(link) }
}
