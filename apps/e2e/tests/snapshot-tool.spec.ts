import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { run, SNAPSHOTS_DIR } from "../tools/snapshot/cli.ts"
import { findViolations, sanitizeHtml } from "../tools/snapshot/sanitize.ts"

const RAW = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "snapshot", "fixtures", "raw-ats.html")
const GOLDEN = join(SNAPSHOTS_DIR, "local-fixture", "index.html")
const LEAKS = [
  "jane.doe@gmail.com",
  "555 123 4567",
  "555-123-4567",
  "Zm9vYmFy",
  "ghp_",
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
let origin: string
const seen: Seen[] = []
let out: string

test.beforeAll(async () => {
  const html = await readFile(RAW, "utf8")
  server = createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", userAgent: String(req.headers["user-agent"]) })
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test.beforeEach(async () => {
  seen.length = 0
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
    root: "#application-form",
    fields: { hidden: 3, file: 1, textarea: 1 },
  })
  expect(Object.keys(meta).sort()).toEqual(["capturedAt", "fields", "root", "source", "tool"])
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
  expect(await capture()).toBe(0)
  expect(await readFile(join(out, "fixture", "index.html"), "utf8")).toBe(first)
  expect(await readFile(GOLDEN, "utf8")).toBe(first)
})

test("refuses a loopback host without --allow-local and writes nothing", async () => {
  const code = await run([`${origin}/jobs/acme/apply`, "--slug", "fixture", "--out", out])
  expect(code).toBe(1)
  expect(seen).toEqual([])
  await expect(readFile(join(out, "fixture", "index.html"), "utf8")).rejects.toThrow()
})

test("--check passes a clean folder and refuses a dirty one", async () => {
  expect(await capture()).toBe(0)
  expect(await run(["--check", out])).toBe(0)

  await writeFile(
    join(out, "fixture", "index.html"),
    '<body><script src="https://x.test/a.js"></script><p>jane@acme.test</p></body>',
  )
  expect(await run(["--check", out])).toBe(1)
})
