import http from "node:http"
import type { AddressInfo } from "node:net"
import net from "node:net"
import type { FetchLimits, Target, Transport } from "./guard"
import { HostGate, UserBudget } from "./limits"
import type { WatchRuntime } from "./run"

/** A real public address (never contacted: the test transport sends every connection to the mock site). */
export const PUBLIC_IP = "93.184.216.34"

export type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void

export interface MockSite {
  port: number
  /** Method and path of every request that arrived, in order. */
  hits: string[]
  headers: http.IncomingHttpHeaders[]
  route(path: string, handler: Handler): void
  close(): Promise<void>
}

export async function startMockSite(): Promise<MockSite> {
  const routes = new Map<string, Handler>()
  const hits: string[] = []
  const headers: http.IncomingHttpHeaders[] = []
  const sockets = new Set<net.Socket>()
  const server = http.createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`)
    headers.push(request.headers)
    const handler = routes.get((request.url ?? "").split("?")[0] ?? "")
    if (handler) handler(request, response)
    else {
      response.statusCode = 404
      response.end()
    }
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    port: (server.address() as AddressInfo).port,
    hits,
    headers,
    route: (path, handler) => void routes.set(path, handler),
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

export interface TestTransport extends Transport {
  /** Every name asked of dns, in order. */
  resolved: string[]
  /** `ip:port` of every connection made. */
  dialed: Target[]
}

/**
 * Dns and the connection stood in for. Names resolve to `hosts[name]` (a public address by default for any `.test` name,
 * so the real checks run on it), and every connection, whatever address it was vetted for, goes to the mock site.
 */
export function testTransport(site: MockSite, hosts: Record<string, string[] | (() => string[])> = {}): TestTransport {
  const resolved: string[] = []
  const dialed: Target[] = []
  return {
    resolved,
    dialed,
    async resolve(name) {
      resolved.push(name)
      const answer = hosts[name]
      if (answer) return typeof answer === "function" ? answer() : answer
      if (name.endsWith(".test")) return [PUBLIC_IP]
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
    },
    dial(target) {
      dialed.push(target)
      return net.connect(site.port, "127.0.0.1")
    },
  }
}

export function testRuntime(
  transport: Transport,
  options: { limits?: Partial<FetchLimits>; refreshMinutes?: number; hostGapMs?: number; userFetches?: number } = {},
): WatchRuntime {
  return {
    guard: { transport, limits: options.limits },
    gate: new HostGate(options.hostGapMs ?? 0),
    budget: new UserBudget(options.userFetches ?? 1_000, 60 * 60 * 1000),
    refreshMinutes: options.refreshMinutes ?? 60,
  }
}
