import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createServer as createSecureServer } from "node:https"
import type { AddressInfo } from "node:net"
import type { Handler, RequestMeta } from "./app.ts"
import { clientIpOf } from "./client-ip.ts"

/** fetch cannot carry TRACE or CONNECT and a playground has no use for PUT or PATCH: everything else is refused before a Request is built. */
const METHODS = new Set(["GET", "HEAD", "POST", "DELETE"])
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i

export interface ServerOptions {
  maxBody: number
  trustedProxies: number
}

const text = (status: number, body: string, extra: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...extra } })

class BodyTooLarge extends Error {}

/** A body stream that counts what it passes on and errors past the cap, so a chunked body never sits in memory whole. */
function limitedBody(req: IncomingMessage, max: number, onExceed: () => void): ReadableStream<Uint8Array> {
  let total = 0
  return new ReadableStream<Uint8Array>({
    start(controller) {
      req.on("data", (chunk: Buffer) => {
        total += chunk.length
        if (total > max) {
          req.removeAllListeners("data")
          req.pause()
          controller.error(new BodyTooLarge())
          onExceed()
          return
        }
        controller.enqueue(new Uint8Array(chunk))
      })
      req.on("end", () => {
        try {
          controller.close()
        } catch {}
      })
      req.on("error", (error) => {
        try {
          controller.error(error)
        } catch {}
      })
    },
    cancel() {
      req.destroy()
    },
  })
}

/** Null when the request cannot be served at all: the answer is already in `reply`. */
export function toRequest(
  req: IncomingMessage,
  secure: boolean,
  options: ServerOptions,
  onExceed: () => void,
): { request: Request } | { reply: Response } {
  const method = (req.method ?? "GET").toUpperCase()
  if (!METHODS.has(method)) return { reply: text(405, "method not allowed", { allow: "GET, HEAD, POST, DELETE" }) }
  const host = req.headers.host ?? ""
  const path = req.url ?? "/"
  if (!HOST.test(host) || !path.startsWith("/") || path.length > 4096) return { reply: text(400, "bad request") }
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  const declared = Number(req.headers["content-length"] ?? 0)
  if (declared > options.maxBody) return { reply: text(413, "too large", { connection: "close" }) }
  const hasBody = method !== "GET" && method !== "HEAD"
  try {
    const url = new URL(`${secure ? "https" : "http"}://${host}${path}`)
    return {
      request: new Request(url, {
        method,
        headers,
        body: hasBody ? limitedBody(req, options.maxBody, onExceed) : undefined,
        // @ts-expect-error node needs this to stream a request body
        duplex: "half",
      }),
    }
  } catch {
    return { reply: text(400, "bad request") }
  }
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  if (res.headersSent) return
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length) headers["set-cookie"] = cookies
  res.writeHead(response.status, headers)
  const body = Buffer.from(await response.arrayBuffer())
  await new Promise<void>((done) => res.end(body, () => done()))
}

export function nodeListener(handle: Handler, secure: boolean, options: ServerOptions) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const refuse = (response: Response): void => {
      // an answer already went out (the handler gave up early): nothing is left to deliver, drop the sender now
      if (res.headersSent) {
        req.socket.destroy()
        return
      }
      res.shouldKeepAlive = false
      send(response, res)
        .catch(() => undefined)
        .finally(() => {
          // destroying at once would reset the connection and the sender might never read the answer: give it a second
          const timer = setTimeout(() => req.socket.destroy(), 1_000)
          timer.unref()
          req.socket.once("close", () => clearTimeout(timer))
        })
    }
    let built: ReturnType<typeof toRequest>
    try {
      built = toRequest(req, secure, options, () => refuse(text(413, "too large", { connection: "close" })))
    } catch {
      built = { reply: text(400, "bad request") }
    }
    if ("reply" in built) {
      refuse(built.reply)
      return
    }
    const meta: RequestMeta = {
      ip: clientIpOf(
        req.headers["x-forwarded-for"]?.toString() ?? null,
        options.trustedProxies,
        req.socket.remoteAddress,
      ),
    }
    Promise.resolve()
      .then(() => handle(built.request, meta))
      .then((response) => send(response, res))
      .catch(() => {
        if (res.destroyed) return
        if (!res.headersSent) res.writeHead(500)
        res.end("server error")
      })
  }
}

export interface Listening {
  server: Server
  port: number
  close: () => Promise<void>
}

export async function listen(
  handle: Handler,
  options: {
    port: number
    host?: string
    tls?: { key: string; cert: string }
    maxBody?: number
    trustedProxies?: number
  },
): Promise<Listening> {
  const listener = nodeListener(handle, !!options.tls, {
    maxBody: options.maxBody ?? 1_000_000,
    trustedProxies: options.trustedProxies ?? 0,
  })
  // node's defaults wait five minutes for a request: a slow client holds a socket far too long for a test page
  const limits = { maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 }
  const server = options.tls
    ? createSecureServer({ ...options.tls, ...limits }, listener)
    : createServer(limits, listener)
  // CONNECT never reaches the request listener: without an answer node would just drop the socket
  server.on("connect", (_req, socket) => {
    socket.end(
      "HTTP/1.1 405 Method Not Allowed\r\nallow: GET, HEAD, POST, DELETE\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
    )
  })
  server.maxHeadersCount = 50
  server.maxConnections = 200
  await new Promise<void>((resolve) => server.listen(options.port, options.host ?? "127.0.0.1", resolve))
  return {
    server,
    port: (server.address() as AddressInfo).port,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve(),
        ),
      )
    },
  }
}
