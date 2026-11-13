import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { connect } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { installProcessGuards } from "./guards.ts"
import { listen } from "./node-server.ts"

const HERE = dirname(fileURLToPath(import.meta.url))

// The hostile cases run against the real entry point under node, the runtime the image uses: bun's own http server
// behaves differently around destroyed sockets and bodies, so a green run there would prove little.
let child: ChildProcess
let port = 0

beforeAll(async () => {
  child = spawn("node", [join(HERE, "index.ts")], {
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      PLAYGROUND_URL: "http://playground.localhost:3004",
      PLAYGROUND_RATE_BURST: "0",
      UMAMI_URL: "",
      GLITCHTIP_DSN: "",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "inherit"],
  })
  port = await new Promise<number>((resolve, reject) => {
    child.on("exit", () => reject(new Error("the playground did not start")))
    child.stdout?.on("data", (chunk: Buffer) => {
      const found = /listening on (\d+)/.exec(chunk.toString())
      if (found) resolve(Number(found[1]))
    })
  })
})
afterAll(() => {
  child.kill()
})

/** One raw request, the whole answer. */
function raw(payload: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1")
    let answer = ""
    socket.on("data", (chunk) => {
      answer += chunk.toString()
    })
    socket.on("close", () => resolve(answer))
    socket.on("error", () => undefined)
    socket.write(payload)
  })
}

const status = (answer: string): string => answer.split("\r\n")[0] ?? ""
const health = (): Promise<string> => raw("GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")

describe("hostile requests over a real socket", () => {
  test("a bad Host header or a method fetch cannot carry is answered and the server keeps serving", async () => {
    const request = (method: string, host: string | null) =>
      `${method} / HTTP/1.1\r\n${host === null ? "" : `Host: ${host}\r\n`}Connection: close\r\n\r\n`
    for (const host of ["a b", "", "a@b", "a/b", "[::1"]) {
      expect(status(await raw(request("GET", host)))).toContain("400")
    }
    for (const method of ["TRACE", "CONNECT", "PUT", "PATCH"]) {
      expect(status(await raw(request(method, `127.0.0.1:${port}`)))).toContain("405")
    }
    expect(status(await raw(request("FOO", `127.0.0.1:${port}`)))).toMatch(/40[05]/)
    expect(status(await raw("GET http://x/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"))).toContain("400")
    expect(status(await health())).toContain("200")
  })

  test("a declared body over the cap is refused before it is read", async () => {
    const answer = await raw(
      "POST /api/submissions HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 20000000\r\nConnection: close\r\n\r\n",
    )
    expect(status(answer)).toContain("413")
  })

  test("a chunked body is cut off at the cap: 413, the sender dropped after a few MB, memory flat, still serving", async () => {
    const rss = (): number =>
      Number(
        spawnSync("ps", ["-o", "rss=", "-p", String(child.pid)])
          .stdout.toString()
          .trim(),
      ) / 1024
    const before = rss()
    const flood = spawnSync("node", [join(HERE, "test", "flood.mjs"), String(port)], { timeout: 60_000 })
    const result = JSON.parse(flood.stdout.toString()) as { sentMb: number; closed: boolean; status: string }
    expect(result.closed).toBe(true)
    expect(result.sentMb).toBeLessThan(100)
    expect(result.status).toContain("413")
    expect(rss() - before).toBeLessThan(250)
    expect(status(await health())).toContain("200")
  }, 90_000)
})

describe("listen", () => {
  test("sets its own timeouts and header limits instead of node's five minute defaults", async () => {
    const one = await listen(async () => new Response("ok"), { port: 0 })
    try {
      expect(one.server.requestTimeout).toBe(15_000)
      expect(one.server.headersTimeout).toBe(10_000)
      expect(one.server.keepAliveTimeout).toBe(5_000)
      expect(one.server.maxHeadersCount).toBe(50)
      expect(one.server.maxConnections).toBe(200)
    } finally {
      await one.close()
    }
  })
})

const raise = (error: Error): boolean =>
  (process.emit as unknown as (event: string, ...args: unknown[]) => boolean).call(process, "uncaughtException", error)

describe("process guards", () => {
  test("a stray error is logged as a fixed line and the process lives, a loop of them restarts it", () => {
    const lines: string[] = []
    const codes: number[] = []
    const off = installProcessGuards({
      maxPerMinute: 2,
      log: (line) => lines.push(line),
      exit: (code) => codes.push(code),
    })
    try {
      raise(new Error("secret ana.silva@example.com"))
      raise(new Error("x"))
      expect(codes).toEqual([])
      raise(new Error("x"))
    } finally {
      off()
    }
    expect(codes).toEqual([1])
    expect(lines[0]).toBe("playground: uncaught exception caught, still serving")
    expect(lines.join("\n")).not.toContain("ana.silva")
  })
})
