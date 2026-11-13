import { isIP } from "node:net"

/**
 * The client address: the entry `trustedProxies` places from the right of `x-forwarded-for` (what the first proxy we
 * trust saw as its client), else the socket's own address. Same rule as the api's helper, which lives in an app and
 * cannot be imported from here.
 */
export function clientIpOf(forwarded: string | null, trustedProxies: number, peer: string | undefined): string | null {
  if (trustedProxies > 0) {
    const entries = (forwarded ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
    const entry = entries[Math.max(0, entries.length - trustedProxies)]
    if (entry && isIP(entry)) return entry
  }
  return peer && isIP(peer) ? peer : null
}
