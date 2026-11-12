import { lookup } from "node:dns/promises"
import http from "node:http"
import net from "node:net"
import tls from "node:tls"
import { createGunzip } from "node:zlib"
import { cleanText } from "../gmail/text"
import { FetchError } from "./errors"
import { checkUrl, ipLiteral, isPublicIp } from "./ip"
import type { HostGate } from "./limits"

export const USER_AGENT = "skiffr-watcher/1.0"

export const FETCH_LIMITS = {
  /** Bytes read off the wire, and again bytes after decompression: a gzip bomb stops at the same number. */
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  /** The whole fetch, redirects and dns included. */
  totalMs: 20_000,
  /** No byte for this long. */
  idleMs: 8_000,
  maxAddresses: 3,
}
export type FetchLimits = typeof FETCH_LIMITS

const MEDIA_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/rdf+xml",
  "application/json",
  "application/feed+json",
  "application/ld+json",
])
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
const RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000

export interface Target {
  /** A vetted address: the only thing ever connected to. */
  ip: string
  port: number
  /** The name in the url, used for the Host header and for checking the certificate. */
  hostname: string
  secure: boolean
}

/** The two things that touch the network, so a test can stand in for dns and for the connection. */
export interface Transport {
  resolve(hostname: string): Promise<string[]>
  dial(target: Target): net.Socket
}

export const systemTransport: Transport = {
  async resolve(hostname) {
    const found = await lookup(hostname, { all: true, verbatim: true })
    return found.map((entry) => entry.address)
  },
  dial({ ip, port, hostname, secure }) {
    if (!secure) return net.connect({ host: ip, port })
    return tls.connect({ host: ip, port, servername: net.isIP(hostname) ? undefined : hostname, minVersion: "TLSv1.2" })
  },
}

export interface GuardDeps {
  transport: Transport
  gate?: HostGate
  limits?: Partial<FetchLimits>
  now?: () => number
}

export interface PageRequest {
  url: string
  accept: string
  etag?: string | null
  lastModified?: string | null
}

export type Page =
  | { status: "ok"; url: string; contentType: string; body: string; etag: string | null; lastModified: string | null }
  | { status: "not_modified" }

type Hop = { redirect: URL } | Page

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

function retryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, RETRY_AFTER_MAX_MS) : undefined
}

function validators(value: string | undefined): string | null {
  return value && cleanText(value, 200) === value ? value : null
}

function decode(bytes: Buffer, contentType: string): string {
  const charset = /charset="?([\w.:-]{1,40})/i.exec(contentType)?.[1]
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

/** Every address a name resolves to must be public: one private answer refuses the host, so a mixed answer can't be used to slip one through. */
async function vet(deps: GuardDeps, url: URL, deadline: number, now: () => number, max: number): Promise<string[]> {
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  const literal = ipLiteral(host)
  if (literal !== null) return [literal]
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FetchError("timeout")), Math.max(1, deadline - now()))
  })
  let found: string[]
  try {
    found = await Promise.race([deps.transport.resolve(host), timeout])
  } catch (error) {
    if (error instanceof FetchError) throw error
    throw new FetchError("dns")
  } finally {
    clearTimeout(timer)
  }
  if (found.length === 0) throw new FetchError("dns")
  if (!found.every(isPublicIp)) throw new FetchError("blocked")
  return found.slice(0, max)
}

function exchange(
  deps: GuardDeps,
  url: URL,
  ip: string,
  request: PageRequest,
  limits: FetchLimits,
  deadline: number,
  now: () => number,
): Promise<Hop> {
  const secure = url.protocol === "https:"
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const port = url.port ? Number(url.port) : secure ? 443 : 80
  const conditional = request.url === url.href
  return new Promise<Hop>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup: Array<() => void> = []
    const done = (outcome: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const stop of cleanup) stop()
      outcome()
    }
    const ok = (hop: Hop) => done(() => resolve(hop))
    const fail = (error: FetchError) => done(() => reject(error))

    const req = http.request(
      {
        host: hostname,
        port,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        // No agent: with a connection factory and no agent, node and bun use the factory and nothing else. The lookup
        // only exists so a runtime that ignored the factory would fail here instead of resolving the name a second time.
        lookup: (_host, _options, callback) => callback(new Error("lookup is not allowed"), ""),
        headers: {
          host: url.host,
          "user-agent": USER_AGENT,
          accept: request.accept,
          "accept-encoding": "gzip",
          connection: "close",
          ...(conditional && request.etag ? { "if-none-match": request.etag } : {}),
          ...(conditional && request.lastModified ? { "if-modified-since": request.lastModified } : {}),
        },
        createConnection: () => deps.transport.dial({ ip, port, hostname, secure }),
      },
      (res) => {
        const status = res.statusCode ?? 0
        const abort = (error: FetchError) => {
          res.destroy()
          req.destroy()
          fail(error)
        }
        if (REDIRECTS.has(status)) {
          const location = header(res.headers.location)
          res.destroy()
          try {
            if (!location || location.length > 4_096) throw new Error("location")
            return ok({ redirect: new URL(location, url) })
          } catch {
            return fail(new FetchError("upstream", status))
          }
        }
        if (status === 304) {
          res.destroy()
          return ok({ status: "not_modified" })
        }
        if (status < 200 || status >= 300) {
          res.destroy()
          if (status === 404 || status === 410) return fail(new FetchError("not_found", status))
          if (status === 429)
            return fail(new FetchError("rate_limited", status, retryAfter(header(res.headers["retry-after"]))))
          return fail(new FetchError("upstream", status, retryAfter(header(res.headers["retry-after"]))))
        }
        const contentType = header(res.headers["content-type"]) ?? ""
        const media = contentType.split(";")[0]?.trim().toLowerCase() ?? ""
        if (!MEDIA_TYPES.has(media)) return abort(new FetchError("content_type", status))
        const encoding = header(res.headers["content-encoding"])?.trim().toLowerCase()
        if (encoding && encoding !== "identity" && encoding !== "gzip")
          return abort(new FetchError("content_type", status))
        const length = Number(header(res.headers["content-length"]))
        if (Number.isFinite(length) && length > limits.maxBytes) return abort(new FetchError("too_large", status))

        const chunks: Buffer[] = []
        let wire = 0
        let bytes = 0
        const gunzip = encoding === "gzip" ? createGunzip() : null
        const body = gunzip ?? res
        res.on("data", (chunk: Buffer) => {
          wire += chunk.length
          if (wire > limits.maxBytes) abort(new FetchError("too_large", status))
        })
        body.on("data", (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > limits.maxBytes) {
            gunzip?.destroy()
            return abort(new FetchError("too_large", status))
          }
          chunks.push(chunk)
        })
        body.on("end", () => {
          ok({
            status: "ok",
            url: url.href,
            contentType: media,
            body: decode(Buffer.concat(chunks), contentType),
            etag: validators(header(res.headers.etag)),
            lastModified: validators(header(res.headers["last-modified"])),
          })
        })
        body.on("error", () => abort(new FetchError("upstream", status)))
        if (gunzip) res.pipe(gunzip)
        res.on("error", () => abort(new FetchError("network", status)))
        res.on("close", () => {
          if (!res.complete) abort(new FetchError("network", status))
        })
        cleanup.push(() => gunzip?.destroy())
      },
    )
    timer = setTimeout(
      () => {
        req.destroy()
        fail(new FetchError("timeout"))
      },
      Math.max(1, Math.min(deadline - now(), limits.totalMs)),
    )
    req.setTimeout(limits.idleMs, () => {
      req.destroy()
      fail(new FetchError("timeout"))
    })
    req.on("error", () => fail(new FetchError("network")))
    req.end()
  })
}

async function hop(
  deps: GuardDeps,
  url: URL,
  request: PageRequest,
  limits: FetchLimits,
  deadline: number,
): Promise<Hop> {
  const now = deps.now ?? Date.now
  const checked = checkUrl(url)
  const addresses = await vet(deps, checked, deadline, now, limits.maxAddresses)
  await deps.gate?.wait(checked.hostname.toLowerCase().replace(/\.$/, ""), deadline)
  let last: FetchError = new FetchError("network")
  for (const ip of addresses) {
    try {
      return await exchange(deps, checked, ip, request, limits, deadline, now)
    } catch (error) {
      if (!(error instanceof FetchError) || error.kind !== "network") throw error
      last = error
    }
  }
  throw last
}

/**
 * One GET of a user-supplied url, the only way the server reads a watched page. The url is checked (scheme, credentials,
 * port, host), the name is resolved here and every answer must be public, and the connection goes to that vetted address
 * and nowhere else, so a second lookup can't send it elsewhere (dns rebinding). A redirect is followed up to three times
 * and each hop starts from the top, checks included. Size is capped on the wire and after decompression, the content type
 * is on an allowlist, the whole fetch has a deadline, and no cookie is sent, kept or read.
 */
export async function fetchPage(deps: GuardDeps, request: PageRequest): Promise<Page> {
  const limits = { ...FETCH_LIMITS, ...deps.limits }
  const deadline = (deps.now ?? Date.now)() + limits.totalMs
  let url = checkUrl(request.url)
  for (let redirects = 0; ; redirects++) {
    const outcome = await hop(deps, url, request, limits, deadline)
    if (!("redirect" in outcome)) return outcome
    if (redirects >= limits.maxRedirects) throw new FetchError("upstream")
    url = outcome.redirect
  }
}
