import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { gzipSync } from "node:zlib"
import { FetchError } from "./errors"
import { fetchPage, type GuardDeps, type PageRequest } from "./guard"
import { HostGate } from "./limits"
import { type MockSite, PUBLIC_IP, startMockSite, type TestTransport, testTransport } from "./test-support"

let site: MockSite
let transport: TestTransport

beforeEach(async () => {
  site = await startMockSite()
  transport = testTransport(site, {
    "private.test": ["10.0.0.7"],
    "mixed.test": [PUBLIC_IP, "192.168.1.5"],
    "metadata.test": ["169.254.169.254"],
    "loop.test": ["127.0.0.1"],
    "v6.test": ["::ffff:7f00:1"],
    "ula.test": ["fd00::1"],
  })
})
afterEach(async () => {
  await site.close()
})

const get = (url: string, deps: Partial<GuardDeps> = {}, extra: Partial<PageRequest> = {}) =>
  fetchPage({ transport, ...deps }, { url, accept: "*/*", ...extra })

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(FetchError)
    return (error as FetchError).kind
  }
  return "no error"
}

const html =
  (body: string, type = "text/html") =>
  (_: unknown, res: import("node:http").ServerResponse) => {
    res.setHeader("content-type", type)
    res.end(body)
  }

describe("redirects are checked at every hop", () => {
  const hops = [
    "http://127.0.0.1/admin",
    "http://localhost/",
    "http://10.0.0.5/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://user:pw@good.test/",
    "http://good.test:8080/",
    "ftp://good.test/",
    "http://private.test/",
    "http://metadata.test/latest/",
    "http://loop.test/",
  ]
  for (const location of hops) {
    test(`to ${location}`, async () => {
      site.route("/start", (_, res) => {
        res.statusCode = 302
        res.setHeader("location", location)
        res.end()
      })
      expect(await kindOf(get("http://good.test/start"))).toBe("blocked")
      expect(site.hits).toEqual(["GET /start"])
      expect(transport.dialed.map((target) => target.ip)).toEqual([PUBLIC_IP])
    })
  }

  test("a relative redirect keeps the host and is followed, at most three times", async () => {
    site.route("/a", (_, res) => void res.writeHead(301, { location: "/b" }).end())
    site.route("/b", (_, res) => void res.writeHead(302, { location: "/c" }).end())
    site.route("/c", (_, res) => void res.writeHead(307, { location: "/d" }).end())
    site.route("/d", html("<p>end</p>"))
    site.route("/e", (_, res) => void res.writeHead(308, { location: "/a" }).end())
    expect((await get("http://good.test/a")).status).toBe("ok")
    expect(await kindOf(get("http://good.test/e"))).toBe("upstream")
  })
})

describe("dns answers are vetted and the vetted address is the one dialed", () => {
  for (const name of ["private.test", "mixed.test", "metadata.test", "loop.test", "v6.test", "ula.test"]) {
    test(`${name} is refused and nothing connects`, async () => {
      expect(await kindOf(get(`http://${name}/`))).toBe("blocked")
      expect(transport.dialed).toEqual([])
    })
  }

  test("a name that does not resolve is a dns error", async () => {
    expect(await kindOf(get("http://nowhere.example/"))).toBe("dns")
  })

  test("the name is resolved once per hop and the connection goes to that answer, not to a second lookup", async () => {
    let calls = 0
    const rebinding = testTransport(site, { "rebind.test": () => (calls++ === 0 ? [PUBLIC_IP] : ["127.0.0.1"]) })
    site.route("/", html("<p>ok</p>"))
    const page = await fetchPage({ transport: rebinding }, { url: "http://rebind.test/", accept: "*/*" })
    expect(page.status).toBe("ok")
    expect(rebinding.resolved).toEqual(["rebind.test"])
    expect(rebinding.dialed).toEqual([{ ip: PUBLIC_IP, port: 80, hostname: "rebind.test", secure: false }])
  })

  test("an address literal that is private never reaches dns or the connection", async () => {
    expect(await kindOf(get("http://192.168.0.10/"))).toBe("blocked")
    expect(transport.resolved).toEqual([])
    expect(transport.dialed).toEqual([])
  })
})

describe("what comes back is bounded", () => {
  test("a declared length over the cap is refused before the body is read", async () => {
    site.route("/big", (_, res) => {
      res.setHeader("content-type", "text/html")
      res.setHeader("content-length", String(50 * 1024 * 1024))
      res.write("x")
    })
    expect(await kindOf(get("http://good.test/big", { limits: { maxBytes: 1_000 } }))).toBe("too_large")
  })

  test("a body that never says its length stops at the cap and the connection is dropped", async () => {
    let writes = 0
    let closed = false
    site.route("/stream", (_, res) => {
      res.setHeader("content-type", "text/html")
      res.on("close", () => {
        closed = true
      })
      const timer = setInterval(() => {
        writes++
        res.write("x".repeat(1_000))
      }, 1)
      res.on("close", () => clearInterval(timer))
    })
    expect(await kindOf(get("http://good.test/stream", { limits: { maxBytes: 20_000 } }))).toBe("too_large")
    await Bun.sleep(50)
    expect(closed).toBe(true)
    expect(writes).toBeLessThan(200)
  })

  test("a gzip bomb stops at the cap after decompression", async () => {
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, "a"))
    expect(bomb.length).toBeLessThan(200_000)
    site.route("/bomb", (_, res) => {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" })
      res.end(bomb)
    })
    expect(await kindOf(get("http://good.test/bomb", { limits: { maxBytes: 1024 * 1024 } }))).toBe("too_large")
  })

  test("a gzip body under the cap is read", async () => {
    site.route("/zip", (_, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" })
      res.end(gzipSync("<p>héllo</p>"))
    })
    const page = await get("http://good.test/zip")
    expect(page).toMatchObject({ status: "ok", body: "<p>héllo</p>" })
  })

  test("a body that trickles in is cut at the total deadline", async () => {
    site.route("/slow", (_, res) => {
      res.setHeader("content-type", "text/html")
      const timer = setInterval(() => res.write("x"), 20)
      res.on("close", () => clearInterval(timer))
    })
    const started = Date.now()
    expect(await kindOf(get("http://good.test/slow", { limits: { totalMs: 300, idleMs: 5_000 } }))).toBe("timeout")
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test("a server that goes quiet is cut at the idle limit", async () => {
    site.route("/quiet", (_, res) => {
      res.setHeader("content-type", "text/html")
      res.write("x")
    })
    expect(await kindOf(get("http://good.test/quiet", { limits: { idleMs: 100 } }))).toBe("timeout")
  })

  test("a server that never answers the request is cut at the deadline", async () => {
    site.route("/mute", () => {})
    expect(await kindOf(get("http://good.test/mute", { limits: { totalMs: 200, idleMs: 5_000 } }))).toBe("timeout")
  })

  for (const [type, kind] of [
    ["image/png", "content_type"],
    ["application/octet-stream", "content_type"],
    ["application/pdf", "content_type"],
    ["", "content_type"],
  ] as const) {
    test(`content type "${type}" is refused`, async () => {
      site.route("/t", (_, res) => {
        if (type) res.setHeader("content-type", type)
        res.end("x")
      })
      expect(await kindOf(get("http://good.test/t"))).toBe(kind)
    })
  }

  test("an encoding other than gzip is refused", async () => {
    site.route("/br", (_, res) => {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "br" })
      res.end("x")
    })
    expect(await kindOf(get("http://good.test/br"))).toBe("content_type")
  })

  for (const [status, kind] of [
    [404, "not_found"],
    [410, "not_found"],
    [429, "rate_limited"],
    [500, "upstream"],
    [403, "upstream"],
  ] as const) {
    test(`status ${status} is ${kind}`, async () => {
      site.route("/s", (_, res) => void res.writeHead(status, { "retry-after": "120" }).end())
      expect(await kindOf(get("http://good.test/s"))).toBe(kind)
    })
  }

  test("a retry-after is kept but capped at a day", async () => {
    site.route("/s", (_, res) => void res.writeHead(429, { "retry-after": "999999999" }).end())
    const error = await get("http://good.test/s").catch((e: FetchError) => e)
    expect((error as FetchError).retryAfterMs).toBe(24 * 60 * 60 * 1000)
  })
})

describe("what is sent", () => {
  test("a fixed user agent and nothing that identifies the user: no cookie, no authorization, no referer", async () => {
    site.route("/start", (_, res) => {
      res.writeHead(302, { location: "/next", "set-cookie": "session=abc; Path=/" }).end()
    })
    site.route("/next", html("<p>ok</p>"))
    await get("http://good.test/start")
    expect(site.hits).toEqual(["GET /start", "GET /next"])
    for (const sent of site.headers) {
      expect(sent["user-agent"]).toBe("skiffr-watcher/1.0")
      expect(sent.host).toBe("good.test")
      expect(Object.keys(sent).sort()).toEqual(["accept", "accept-encoding", "connection", "host", "user-agent"])
    }
  })

  test("validators are sent on the first hop and a 304 is not a failure", async () => {
    site.route("/f", (req, res) => {
      if (req.headers["if-none-match"] === '"v1"') return void res.writeHead(304).end()
      res.writeHead(200, {
        "content-type": "application/rss+xml",
        etag: '"v1"',
        "last-modified": "Tue, 10 Nov 2026 10:00:00 GMT",
      })
      res.end("<rss/>")
    })
    const first = await get("http://good.test/f")
    expect(first).toMatchObject({ status: "ok", etag: '"v1"', lastModified: "Tue, 10 Nov 2026 10:00:00 GMT" })
    expect(await get("http://good.test/f", {}, { etag: '"v1"' })).toEqual({ status: "not_modified" })
  })
})

test("requests to one host are spaced out, and give up when the slot is past the deadline", async () => {
  const waits: number[] = []
  let clock = 1_000
  const gate = new HostGate(
    500,
    async (ms) => void waits.push(ms),
    () => clock,
  )
  await gate.wait("a.test", 10_000)
  await gate.wait("a.test", 10_000)
  await gate.wait("b.test", 10_000)
  expect(waits).toEqual([500])
  clock = 1_100
  await expect(gate.wait("a.test", 1_200)).rejects.toMatchObject({ kind: "rate_limited" })
})
