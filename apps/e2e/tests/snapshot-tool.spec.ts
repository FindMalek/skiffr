import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { SNAPSHOTS_DIR } from "../tools/snapshot/check.ts"
import { run } from "../tools/snapshot/cli.ts"
import { findViolations, sanitizeHtml } from "../tools/snapshot/sanitize.ts"

const RAW = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "snapshot", "fixtures", "raw-ats.html")
const GOLDEN = join(SNAPSHOTS_DIR, "local-fixture", "index.html")
const LEAKS = [
  "jane.doe@example.invalid",
  "555 123 4567",
  "555-123-4567",
  "Zm9vYmFy",
  "TOKEN-0123",
  "4012345678",
  "9f2c0a1b7d3e4c5a8b6d",
  "n-8f14e45f",
  "abcdef0123456789",
  "tracker.invalid",
  "evil.invalid",
  "Berlin",
  "Dear team",
]

interface Seen {
  method: string
  url: string
  userAgent: string
}

let server: Server
let internal: Server
let origin: string
let localhost: string
let internalPort: number
const seen: Seen[] = []
const reached: string[] = []
let out: string

const BUSY = `<!doctype html><title>Busy</title><form><input name="a"><input name="b"><input name="c"></form><script>setTimeout(() => { for (;;) {} }, 200)</script>`

const probe = (
  port: number,
): string => `<!doctype html><title>Probe</title><form><input name="a"><input name="b"><input name="c"></form><script>
  const target = ${port}
  fetch("/ping").catch(() => undefined)
  fetch("http://127.0.0.1:" + target + "/direct").catch(() => undefined)
  fetch("http://[::ffff:7f00:1]:" + target + "/mapped").catch(() => undefined)
  fetch("http://[::ffff:127.0.0.1]:" + target + "/dotted").catch(() => undefined)
  fetch("/redirect").catch(() => undefined)
  try { new WebSocket("ws://127.0.0.1:" + target + "/socket") } catch {}
  try { new WebSocket("ws://[::ffff:7f00:1]:" + target + "/socket-mapped") } catch {}
</script>`

test.beforeAll(async () => {
  const html = await readFile(RAW, "utf8")
  internal = createServer((req, res) => {
    reached.push(`${req.method} ${req.url}`)
    res.writeHead(200, { "access-control-allow-origin": "*" }).end("INTERNAL")
  })
  internal.on("upgrade", (req, socket) => {
    reached.push(`UPGRADE ${req.url}`)
    socket.destroy()
  })
  await new Promise<void>((resolve) => internal.listen(0, "::", resolve))
  internalPort = (internal.address() as AddressInfo).port

  server = createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", userAgent: String(req.headers["user-agent"]) })
    if (req.url === "/redirect") {
      res.writeHead(302, { location: `http://127.0.0.1:${internalPort}/redirect-hop` }).end()
      return
    }
    const body = req.url === "/busy" ? BUSY : req.url === "/probe" ? probe(internalPort) : html
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  origin = `http://127.0.0.1:${port}`
  localhost = `http://localhost:${port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise<void>((resolve) => internal.close(() => resolve()))
})

test.beforeEach(async () => {
  seen.length = 0
  reached.length = 0
  out = await mkdtemp(join(tmpdir(), "skiffr-snapshot-out-"))
})

test.afterEach(async () => {
  await rm(out, { recursive: true, force: true })
})

const capture = (extra: string[] = []): Promise<number> =>
  run([
    `${origin}/jobs/acme/apply`,
    "--allow-local",
    "--click",
    "#apply-button",
    "--slug",
    "fixture",
    "--out",
    out,
    "--settle",
    "300",
    ...extra,
  ])

test("snapshots a page full of scripts, trackers and tokens into a clean page", async () => {
  expect(await capture()).toBe(0)
  const html = await readFile(join(out, "fixture", "index.html"), "utf8")

  expect(findViolations(html)).toEqual([])
  for (const leak of LEAKS) expect(html).not.toContain(leak)
  expect(html).toContain('name="first_name"')
  expect(html).toContain('<input name="authenticity_token" type="hidden" value="x">')
  expect(html).toMatch(/class="hp" style="[^"]*left:-9999px[^"]*position:absolute/)
  expect(html).toMatch(/class="ghost" style="opacity:0"/)
  expect(html).toContain('data-skiffr-placeholder="iframe"')
  expect(sanitizeHtml(html)).toBe(html)

  const meta = JSON.parse(await readFile(join(out, "fixture", "meta.json"), "utf8"))
  expect(meta).toMatchObject({
    source: "127.0.0.1",
    root: "body > main > div > form",
    fields: { hidden: 3, file: 1, textarea: 1 },
  })
  expect(Object.keys(meta).sort()).toEqual(["capturedAt", "fields", "root", "source", "tool"])
  expect(await run(["--check", out])).toBe(0)
})

test("only reads the page: get requests with a skiffr user agent", async () => {
  expect(await capture()).toBe(0)
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.every((request) => request.method === "GET")).toBe(true)
  expect(
    seen.every((request) =>
      /^skiffr-snapshot\/[\d.]+ \(\+https:\/\/github\.com\/FindMalek\/skiffr/.test(request.userAgent),
    ),
  ).toBe(true)
})

test("the same page gives the same bytes and the committed snapshot", async () => {
  expect(await capture()).toBe(0)
  const first = await readFile(join(out, "fixture", "index.html"), "utf8")
  expect(await capture(["--force"])).toBe(0)
  expect(await readFile(join(out, "fixture", "index.html"), "utf8")).toBe(first)
  expect(await readFile(GOLDEN, "utf8")).toBe(first)
})

test("replaces an existing snapshot only with --force", async () => {
  expect(await capture()).toBe(0)
  await writeFile(join(out, "fixture", "index.html"), "kept")
  expect(await capture()).toBe(1)
  expect(await readFile(join(out, "fixture", "index.html"), "utf8")).toBe("kept")
  expect(await capture(["--force"])).toBe(0)
})

test("the folder name is the host, never the path", async () => {
  expect(
    await run([`${origin}/in/jane-smith/apply`, "--allow-local", "--root", "form", "--out", out, "--settle", "100"]),
  ).toBe(0)
  await expect(readFile(join(out, "127-0-0-1", "meta.json"), "utf8")).resolves.toContain("127.0.0.1")
})

test("a flag value that looks like a flag is an error, not a crash", async () => {
  expect(await run([`${origin}/`, "--slug", "-a", "--out", out])).toBe(1)
})

test("refuses a loopback host without --allow-local and writes nothing", async () => {
  const code = await run([`${origin}/jobs/acme/apply`, "--slug", "fixture", "--out", out])
  expect(code).toBe(1)
  expect(seen).toEqual([])
  await expect(readFile(join(out, "fixture", "index.html"), "utf8")).rejects.toThrow()
})

test("refuses every spelling of loopback as the page address", async () => {
  const port = new URL(origin).port
  for (const host of ["[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::7f00:1]", "0x7f.1", "2130706433", "127.1"]) {
    expect(await run([`http://${host}:${port}/`, "--out", out])).toBe(1)
  }
  expect(seen).toEqual([])
})

test("a page cannot reach an internal service by fetch, redirect or websocket", async () => {
  expect(
    await run([
      `${localhost}/probe`,
      "--allow-local",
      "--root",
      "form",
      "--slug",
      "probe",
      "--out",
      out,
      "--settle",
      "1500",
    ]),
  ).toBe(0)
  expect(seen.map((request) => request.url)).toContain("/ping")
  expect(reached).toEqual([])
})

test("gives up on a page that never finishes", async () => {
  test.setTimeout(60_000)
  const started = Date.now()
  const code = await run([
    `${origin}/busy`,
    "--allow-local",
    "--root",
    "form",
    "--slug",
    "busy",
    "--out",
    out,
    "--timeout",
    "2000",
    "--settle",
    "100",
  ])
  expect(code).toBe(1)
  expect(Date.now() - started).toBeLessThan(40_000)
})

test.describe("--check", () => {
  async function clean(): Promise<string> {
    expect(await capture()).toBe(0)
    return join(out, "fixture")
  }

  test("passes a clean folder", async () => {
    await clean()
    expect(await run(["--check", out])).toBe(0)
  })

  test("refuses a missing directory", async () => {
    expect(await run(["--check", join(out, "nope")])).toBe(1)
  })

  const tamper: [string, (folder: string) => Promise<void>][] = [
    [
      "a script in the page",
      async (f) =>
        writeFile(
          join(f, "index.html"),
          '<body><script src="https://x.test/a.js"></script><p>jane@acme.test</p></body>',
        ),
    ],
    ["an extra raw file", async (f) => writeFile(join(f, "raw.html"), "<script>1</script>")],
    ["index.htm next to index.html", async (f) => writeFile(join(f, "index.htm"), "<script>1</script>")],
    [
      "a nested folder",
      async (f) => {
        await mkdir(join(f, "sub"))
        await writeFile(join(f, "sub", "index.html"), "<script>1</script>")
      },
    ],
    [
      "a loose file in the snapshots folder",
      async (f) => writeFile(join(dirname(f), "loose.html"), "<script>1</script>"),
    ],
    ["a symlinked folder", async (f) => symlink(f, join(dirname(f), "linked"))],
    [
      "a symlinked index.html",
      async (f) => {
        await writeFile(join(dirname(f), "target.html"), "<p>x</p>")
        await rm(join(f, "index.html"))
        await symlink(join(dirname(f), "target.html"), join(f, "index.html"))
      },
    ],
    [
      "a utf-16 page",
      async (f) => writeFile(join(f, "index.html"), Buffer.from("﻿<script>alert(1)</script>", "utf16le")),
    ],
    ["invalid utf-8", async (f) => writeFile(join(f, "index.html"), Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0xfe]))],
    [
      "a hidden value behind a quoted greater than sign",
      async (f) => {
        const html = await readFile(join(f, "index.html"), "utf8")
        await writeFile(
          join(f, "index.html"),
          html.replace("</form>", '<input title="a>b" type="hidden" name="t" value="SECRET"></form>'),
        )
      },
    ],
    [
      "a meta.json root that carries a page id",
      async (f) => {
        const meta = JSON.parse(await readFile(join(f, "meta.json"), "utf8"))
        await writeFile(join(f, "meta.json"), JSON.stringify({ ...meta, root: "#candidate-jane-smith-5551234 > form" }))
      },
    ],
    [
      "a meta.json with an extra key",
      async (f) => {
        const meta = JSON.parse(await readFile(join(f, "meta.json"), "utf8"))
        await writeFile(join(f, "meta.json"), JSON.stringify({ ...meta, note: "x" }))
      },
    ],
    [
      "a page edited by hand",
      async (f) => {
        const html = await readFile(join(f, "index.html"), "utf8")
        await writeFile(join(f, "index.html"), html.replace("<form", '<form data-note="hand edited"'))
      },
    ],
  ]
  for (const [name, change] of tamper) {
    test(`refuses ${name}`, async () => {
      await change(await clean())
      expect(await run(["--check", out])).toBe(1)
    })
  }
})
