import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createServer as createSecureServer } from "node:https"
import type { AddressInfo } from "node:net"
import type { Handler } from "./app.ts"

function toRequest(req: IncomingMessage, secure: boolean): Request {
  const url = `${secure ? "https" : "http"}://${req.headers.host ?? "localhost"}${req.url ?? "/"}`
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD"
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (req as unknown as ReadableStream) : undefined,
    // @ts-expect-error node needs this to stream a request body
    duplex: "half",
  })
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    headers[name] = value
  })
  res.writeHead(response.status, headers)
  res.end(Buffer.from(await response.arrayBuffer()))
}

export function nodeListener(handle: Handler, secure = false) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(toRequest(req, secure))
      .then((response) => send(response, res))
      .catch(() => {
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
  options: { port: number; host?: string; tls?: { key: string; cert: string } },
): Promise<Listening> {
  const listener = nodeListener(handle, !!options.tls)
  const server = options.tls ? createSecureServer(options.tls, listener) : createServer(listener)
  await new Promise<void>((resolve) => server.listen(options.port, options.host ?? "127.0.0.1", resolve))
  return {
    server,
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
