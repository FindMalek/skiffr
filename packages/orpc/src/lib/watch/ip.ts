import { isIPv6 } from "node:net"
import { URL_MAX } from "@skiffr/common/constants"
import { FetchError } from "./errors"

export const ALLOWED_PORTS: readonly number[] = [80, 443]

type Cidr = readonly [base: readonly number[], prefix: number]

/** Everything in IPv4 that is not a public unicast address, from the IANA special-purpose registry. */
const BLOCKED_V4: readonly Cidr[] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
]

/** Inside global unicast (2000::/3) the ranges that are not routed to the public internet. Everything outside 2000::/3 is refused as a whole. */
const BLOCKED_V6: readonly Cidr[] = [
  [[0x20, 0x01, 0x00, 0x00], 23],
  [[0x20, 0x01, 0x0d, 0xb8], 32],
  [[0x20, 0x02], 16],
  [[0x3f, 0xff], 20],
]
const GLOBAL_UNICAST_V6: Cidr = [[0x20], 3]

function within(bytes: readonly number[], [base, prefix]: Cidr): boolean {
  for (let bit = 0; bit < prefix; bit += 8) {
    const mask = prefix - bit >= 8 ? 0xff : (0xff << (8 - (prefix - bit))) & 0xff
    if (((bytes[bit / 8] ?? 0) & mask) !== ((base[bit / 8] ?? 0) & mask)) return false
  }
  return true
}

/** Strict dotted quad: four decimal parts, no leading zeros (their meaning, octal or decimal, depends on who reads them). */
function parseV4(text: string): number[] | null {
  const parts = text.split(".")
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    bytes.push(value)
  }
  return bytes
}

function parseV6(text: string): number[] | null {
  if (text.includes("%") || !isIPv6(text)) return null
  let rest = text
  const lastColon = text.lastIndexOf(":")
  if (text.includes(".")) {
    const v4 = parseV4(text.slice(lastColon + 1))
    if (!v4) return null
    rest = `${text.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`
  }
  const halves = rest.split("::")
  if (halves.length > 2) return null
  const side = (half: string | undefined) => (half ? half.split(":") : [])
  const head = side(halves[0])
  const tail = side(halves[1])
  const fill = 8 - head.length - tail.length
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail]
  const bytes: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
    const value = Number.parseInt(group, 16)
    bytes.push(value >> 8, value & 0xff)
  }
  return bytes.length === 16 ? bytes : null
}

/** True only for a literal IPv4 or IPv6 address that is routed on the public internet. Anything unparseable, special-purpose, mapped or embedded is false. */
export function isPublicIp(text: string): boolean {
  const v4 = parseV4(text)
  if (v4) return !BLOCKED_V4.some((range) => within(v4, range))
  const v6 = parseV6(text)
  if (!v6) return false
  return within(v6, GLOBAL_UNICAST_V6) && !BLOCKED_V6.some((range) => within(v6, range))
}

const PRIVATE_NAME = /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|corp|private|home\.arpa)$/

/** The address literal in a url's host, in the one spelling the WHATWG parser leaves (decimal, hex, octal and short forms are already dotted quads here). */
export function ipLiteral(hostname: string): string | null {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1)
  return parseV4(hostname) ? hostname : null
}

const refuse = () => new FetchError("blocked")

/**
 * The part of the policy that needs no dns: a plain http(s) url without credentials, on port 80 or 443, whose host is
 * not an internal name and, when it is an address, is a public one. The name case is finished at connect time, where
 * every address the name resolves to is checked (see `guard.ts`).
 */
export function checkUrl(input: string | URL): URL {
  let url: URL
  try {
    url = typeof input === "string" ? new URL(input) : new URL(input.href)
  } catch {
    throw refuse()
  }
  if (url.href.length > URL_MAX) throw refuse()
  if (url.protocol !== "http:" && url.protocol !== "https:") throw refuse()
  if (url.username || url.password) throw refuse()
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80
  if (!ALLOWED_PORTS.includes(port)) throw refuse()
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (!host) throw refuse()
  const literal = ipLiteral(host)
  if (literal !== null) {
    if (!isPublicIp(literal)) throw refuse()
  } else if (!host.includes(".") || PRIVATE_NAME.test(host) || /^[\d.]+$/.test(host)) throw refuse()
  return url
}
