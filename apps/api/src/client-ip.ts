import { isIP } from "node:net"

export interface ClientIpConfig {
  /** The header the proxy in front sets. */
  header: string
  /** How many proxies append to it between the client and the api: 0 ignores the header. */
  trustedProxies: number
}

/**
 * The client address: the entry `trustedProxies` places from the right of the header (what the first proxy we trust saw
 * as its client, so anything the client sent itself sits to the left and is ignored), else the connection's own address.
 * Null when neither says: the caller keys those requests to one shared bucket instead of letting them pick one.
 */
export function clientIpOf(headers: Headers, config: ClientIpConfig, peer?: string): string | null {
  if (config.trustedProxies > 0) {
    const entries = (headers.get(config.header) ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
    const entry = entries[Math.max(0, entries.length - config.trustedProxies)]
    if (entry && isIP(entry)) return entry
  }
  return peer && isIP(peer) ? peer : null
}
