import dns from "node:dns"
import http from "node:http"
import https from "node:https"
import type { LookupFunction } from "node:net"
import { isPrivateAddress, type RequestGuard } from "./guard.ts"

export const MAX_BODY_BYTES = 15_000_000
export const MAX_TOTAL_BYTES = 100_000_000
const MAX_HOPS = 10
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
  "set-cookie",
  "location",
])

export interface Fetched {
  status: number
  headers: Record<string, string>
  body: Buffer
  /** Where the redirects ended. */
  url: string
}

export interface Fetcher {
  fetch: (url: URL, method: string, headers: Record<string, string>, body?: Buffer) => Promise<Fetched>
  close: () => void
}

/** Resolves a name and refuses it when any answer is private, so the address that is connected to is the one that was vetted. */
function pinnedLookup(allowName: string | null): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      const done = callback as unknown as (
        error: Error | null,
        address?: string | dns.LookupAddress[],
        family?: number,
      ) => void
      if (error) return done(error)
      if (hostname !== allowName && addresses.some((entry) => isPrivateAddress(entry.address))) {
        return done(new Error(`${hostname} resolves to a private address`))
      }
      const first = addresses[0]
      if (!first) return done(new Error(`${hostname} does not resolve`))
      return options.all ? done(null, addresses) : done(null, first.address, first.family)
    })
  }
}

/**
 * Fetches a page the way the browser would, but from node: every hop of a redirect is judged by `guard` before it is
 * requested, the name is resolved and vetted at connect time, bodies are read with a size limit, and redirects are
 * never handed to the browser.
 */
export function createFetcher(options: { guard: RequestGuard; allowName: string | null; timeoutMs: number }): Fetcher {
  const lookup = pinnedLookup(options.allowName)
  const agents = {
    "http:": new http.Agent({ keepAlive: true, maxSockets: 16 }),
    "https:": new https.Agent({ keepAlive: true, maxSockets: 16 }),
  }
  let budget = MAX_TOTAL_BYTES

  function hop(
    url: URL,
    method: string,
    headers: Record<string, string>,
    payload?: Buffer,
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http
      const req = lib.request(
        url,
        {
          method,
          headers: payload ? { ...headers, "content-length": String(payload.length) } : headers,
          lookup,
          agent: agents[url.protocol as "http:" | "https:"],
          signal: AbortSignal.timeout(options.timeoutMs),
        },
        (res) => {
          const status = res.statusCode ?? 0
          if (REDIRECTS.has(status)) {
            res.destroy()
            return resolve({ status, headers: res.headers, body: Buffer.alloc(0) })
          }
          const chunks: Buffer[] = []
          let size = 0
          res.on("data", (chunk: Buffer) => {
            size += chunk.length
            budget -= chunk.length
            if (size > MAX_BODY_BYTES || budget < 0) req.destroy(new Error("response too large"))
            else chunks.push(chunk)
          })
          res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
          res.on("error", reject)
        },
      )
      req.on("error", reject)
      req.end(payload)
    })
  }

  async function fetchPage(
    first: URL,
    method: string,
    headers: Record<string, string>,
    payload?: Buffer,
  ): Promise<Fetched> {
    const sent: Record<string, string> = { ...headers, "accept-encoding": "identity" }
    delete sent.host
    delete sent["content-length"]
    delete sent.connection
    const seen = new Set<string>()
    let url = first
    for (let hops = 0; hops <= MAX_HOPS; hops++) {
      if (seen.has(url.href)) throw new Error("redirect loop")
      seen.add(url.href)
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${url.protocol} is not fetched`)
      const refusal = await options.guard(url.href)
      if (refusal) throw new Error(refusal)
      const res = await hop(url, method, sent, payload)
      const location = res.headers.location
      if (REDIRECTS.has(res.status) && typeof location === "string") {
        url = new URL(location, url)
        continue
      }
      const out: Record<string, string> = {}
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name)) out[name] = Array.isArray(value) ? value.join(", ") : value
      }
      return { status: res.status, headers: out, body: method === "HEAD" ? Buffer.alloc(0) : res.body, url: url.href }
    }
    throw new Error("too many redirects")
  }

  return {
    fetch: fetchPage,
    close: () => {
      agents["http:"].destroy()
      agents["https:"].destroy()
    },
  }
}
