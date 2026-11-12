import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".test", ".invalid", ".example"]

const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"])
const OFFLINE_SCHEMES = new Set(["data:", "blob:", "about:"])

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]

/** Every v6 form that can carry or reach an internal v4 address is blocked whole: compatible, NAT64, 6to4, Teredo. Mapped ones are judged by the v4 rules, which BlockList applies to them. */
const V6_BLOCKED: [string, number][] = [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
]

const BLOCKED = new BlockList()
for (const [net, prefix] of V4_BLOCKED) BLOCKED.addSubnet(net, prefix, "ipv4")
for (const [net, prefix] of V6_BLOCKED) BLOCKED.addSubnet(net, prefix, "ipv6")

const stripBrackets = (host: string): string => host.replace(/^\[|\]$/g, "")

/** True for any address that is not on the public internet, in whatever spelling the url parser or the resolver returns. */
export function isPrivateAddress(address: string): boolean {
  const ip = stripBrackets(address).split("%")[0]?.toLowerCase() ?? ""
  const family = isIP(ip)
  if (family === 0) return false
  return BLOCKED.check(ip, family === 4 ? "ipv4" : "ipv6")
}

/** What the url parser makes of a host name: decimal, hex, octal and short ipv4 and every ipv6 spelling come out canonical. */
export function normalizeHost(hostname: string): string | null {
  try {
    return new URL(`http://${hostname.replace(/\.+$/, "")}/`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** A host that is not on the public internet by its name alone. */
export function localRefusal(hostname: string): string | null {
  const host = normalizeHost(hostname)
  if (host === null) return `${hostname} is not a valid host`
  if (isPrivateAddress(host)) return `${host} is a private or loopback address`
  if (
    isIP(stripBrackets(host)) === 0 &&
    (!host.includes(".") || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix)))
  ) {
    return `${host} is not a public host name`
  }
  return null
}

export function urlRefusal(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return "not a valid url"
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "only http and https pages can be snapshotted"
  if (url.username || url.password) return "the url carries credentials"
  return null
}

/** The name check plus every address the name resolves to, so a public name that points inside the network is refused too. */
export async function hostRefusal(hostname: string): Promise<string | null> {
  const byName = localRefusal(hostname)
  if (byName) return byName
  const host = stripBrackets(normalizeHost(hostname) ?? hostname)
  if (isIP(host) !== 0) return null
  try {
    const addresses = await lookup(host, { all: true })
    const inside = addresses.find((entry) => isPrivateAddress(entry.address))
    return inside ? `${host} resolves to a private address` : null
  } catch {
    return `${host} does not resolve`
  }
}

export type RequestGuard = (rawUrl: string) => Promise<string | null>

/**
 * Judges one request url: a page load, a sub request, a redirect hop or a websocket. With `allowLocal` the page's own host
 * is let through (a local test page loads its own files) and no other private host is.
 */
export function createRequestGuard(options: { allowLocal: boolean; topHost: string }): RequestGuard {
  const verdicts = new Map<string, Promise<string | null>>()
  const top = normalizeHost(options.topHost)
  return async (rawUrl) => {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      return "not a valid url"
    }
    if (OFFLINE_SCHEMES.has(url.protocol)) return null
    if (!NETWORK_SCHEMES.has(url.protocol)) return `${url.protocol} requests are refused`
    const host = normalizeHost(url.hostname)
    if (host === null) return `${url.hostname} is not a valid host`
    if (options.allowLocal && host === top) return null
    const known = verdicts.get(host)
    if (known) return known
    const verdict = hostRefusal(host)
    verdicts.set(host, verdict)
    return verdict
  }
}
