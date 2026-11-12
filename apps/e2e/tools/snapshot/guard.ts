import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".test", ".invalid", ".example"]

function privateV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase()
  if (isIP(ip) === 4) return privateV4(ip)
  if (isIP(ip) !== 6) return false
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)?.[1]
  if (mapped) return privateV4(mapped)
  return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith("ff")
}

/** A host that is not on the public internet by its name alone. */
export function localRefusal(hostname: string): string | null {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "")
  if (isPrivateAddress(host)) return `${host} is a private or loopback address`
  if (isIP(host) === 0 && (!host.includes(".") || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix)))) {
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

/** The name check plus what the name resolves to, so a public name that points inside the network is refused too. */
export async function hostRefusal(hostname: string): Promise<string | null> {
  const byName = localRefusal(hostname)
  if (byName) return byName
  if (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0) return null
  try {
    const addresses = await lookup(hostname, { all: true })
    const inside = addresses.find((entry) => isPrivateAddress(entry.address))
    return inside ? `${hostname} resolves to a private address` : null
  } catch {
    return `${hostname} does not resolve`
  }
}
