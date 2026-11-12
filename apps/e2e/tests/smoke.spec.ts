import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { EXTENSION_DIR } from "../fixtures/extension.ts"
import type { Baseline } from "../smoke/drift.ts"
import { type RunOptions, runSmoke } from "../smoke/runner.ts"
import { parseTargets, type Target } from "../smoke/schema.ts"

const PAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "pages")
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" }

/** What a real site might do behind the extension's back: write requests, and a field that fills itself. */
const WRITES = `<script>
  fetch("/submit", { method: "POST", body: "x" }).catch(() => {})
  navigator.sendBeacon("/submit", "x")
  const xhr = new XMLHttpRequest(); xhr.open("PUT", "/submit"); xhr.send("x")
</script>`
const LEAK = `<script>document.getElementById("email").addEventListener("input", () => { document.getElementById("gender").value = "2" })</script>`

interface Hit {
  method: string
  path: string
}

let server: Server
let origin: string
const hits: Hit[] = []

async function page(file: string, extra = ""): Promise<string> {
  return (await readFile(join(PAGES, file), "utf8")).replace("</body>", `${extra}</body>`)
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://site.local")
      hits.push({ method: req.method ?? "GET", path: url.pathname })
      const html = (body: string) => res.writeHead(200, { "content-type": TYPES[".html"] as string }).end(body)
      if (url.pathname.startsWith("/limited/")) return void res.writeHead(429, { "retry-after": "60" }).end("slow down")
      if (url.pathname === "/gone.html") return void res.writeHead(404).end("not found")
      if (url.pathname === "/moved.html") return void res.writeHead(302, { location: "/elsewhere.html" }).end()
      if (url.pathname === "/elsewhere.html") return html("<!doctype html><title>Careers</title><p>All jobs</p>")
      if (url.pathname === "/site/ok.html") return html(await page("ats/greenhouse.html", WRITES))
      if (url.pathname === "/site/leaky.html") return html(await page("ats/greenhouse.html", LEAK))
      if (url.pathname === "/site/changed.html") return html(await page("negatives/newsletter.html"))
      const file = normalize(url.pathname).replace(/^[/\\]+/, "")
      if (file.startsWith("..") || !TYPES[extname(file)]) return void res.writeHead(404).end("not found")
      const body = await readFile(join(PAGES, file), "utf8").catch(() => null)
      if (body === null) return void res.writeHead(404).end("not found")
      res.writeHead(200, { "content-type": TYPES[extname(file)] as string }).end(body)
    })().catch(() => res.writeHead(500).end())
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test.beforeEach(() => {
  hits.length = 0
})

function targets(...list: { id: string; path: string; over?: Partial<Target> & Record<string, unknown> }[]): Target[] {
  return parseTargets(
    list.map(({ id, path, over }) => ({
      id,
      ats: "greenhouse",
      url: `${origin}${path}`,
      checked: "2026-11-12",
      expect: { minFilled: 3, detect: ["email"], untouched: ["gender"] },
      ...over,
    })),
    { allowLocal: true },
  )
}

function options(list: Target[], over: Partial<RunOptions> = {}): RunOptions {
  return {
    targets: list,
    extensionDir: EXTENSION_DIR,
    timeoutMs: 30_000,
    settleMs: 300,
    delayMs: 0,
    driftThreshold: 0.25,
    allowLocal: true,
    loadBaseline: async () => null,
    ...over,
  }
}

const submits = (): Hit[] => hits.filter((hit) => hit.path === "/submit")

test.describe("read only smoke against local pages", () => {
  test.setTimeout(240_000)

  test("fills a page, never submits, aborts every write and leaves the sensitive field alone", async () => {
    const saved = new Map<string, Baseline>()
    const [result] = await runSmoke(
      options(targets({ id: "site", path: "/site/ok.html" }), {
        saveBaseline: async (id, baseline) => void saved.set(id, baseline),
      }),
    )

    expect(result).toMatchObject({ id: "site", status: "ok" })
    expect(result?.observation).toMatchObject({ toast: true, sensitiveAsked: 0, sensitiveFilled: 0 })
    expect(result?.observation?.filled).toBeGreaterThanOrEqual(3)
    expect(result?.writesAborted).toBeGreaterThanOrEqual(3)
    expect(submits()).toEqual([])
    expect(hits.filter((hit) => hit.method !== "GET" && hit.method !== "HEAD")).toEqual([])
    expect(saved.get("site")).toMatchObject({ collected: result?.observation?.collected })
    expect(Object.keys(saved.get("site") ?? {}).sort()).toEqual([
      "collected",
      "filled",
      "outlined",
      "recorded",
      "signature",
    ])

    const again = await runSmoke(
      options(targets({ id: "site", path: "/site/ok.html" }), { loadBaseline: async (id) => saved.get(id) ?? null }),
    )
    expect(again[0]?.status).toBe("ok")
    expect(again[0]?.notes).not.toContain("field signature changed")
  })

  test("reports drift when the page changes, a field fills against the rules, or a button is gone, and gone for a dead page", async () => {
    const baseline: Baseline = {
      recorded: "2026-11-12",
      collected: 10,
      filled: 8,
      outlined: 2,
      signature: "0123456789abcdef",
    }
    const list = targets(
      { id: "changed", path: "/site/changed.html" },
      { id: "leaky", path: "/site/leaky.html" },
      { id: "no-button", path: "/site/ok.html", over: { click: "#not-there" } },
      { id: "removed", path: "/gone.html" },
      { id: "moved", path: "/moved.html" },
      { id: "off", path: "/site/ok.html", over: { enabled: false } },
    )
    const started = Date.now()
    const results = await runSmoke(options(list, { delayMs: 1_000, loadBaseline: async () => baseline }))
    const by = Object.fromEntries(results.map((result) => [result.id, result]))

    expect(by.changed).toMatchObject({ status: "drift" })
    expect(by.changed?.reasons.join()).toMatch(/detection stopped/)
    expect(by.leaky?.status).toBe("drift")
    expect(by.leaky?.observation?.sensitiveFilled).toBeGreaterThanOrEqual(1)
    expect(by["no-button"]?.status).toBe("drift")
    expect(by["no-button"]?.reasons.join()).toMatch(/apply button/)
    expect(by.removed).toMatchObject({ status: "gone", reasons: ["http 404"] })
    expect(by.moved?.status).toBe("gone")
    expect(by.off).toMatchObject({ status: "skipped", reasons: ["disabled"] })
    // five targets ran with a pause before each but the first
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_000)
    expect(hits.some((hit) => hit.path === "/site/ok.html")).toBe(true)
    expect(submits()).toEqual([])
  })

  test("a host that answers 429 twice stops the run and is not asked again", async () => {
    const list = targets(
      { id: "a", path: "/limited/a.html" },
      { id: "b", path: "/limited/b.html" },
      { id: "c", path: "/limited/c.html" },
      { id: "d", path: "/site/ok.html" },
    )
    const results = await runSmoke(options(list))
    expect(results.map((result) => result.status)).toEqual(["blocked", "blocked", "skipped", "skipped"])
    expect(results[2]?.reasons[0]).toMatch(/run stopped/)
    expect(hits.filter((hit) => hit.path.startsWith("/limited/"))).toHaveLength(2)
    expect(hits.some((hit) => hit.path === "/site/ok.html")).toBe(false)
  })
})
