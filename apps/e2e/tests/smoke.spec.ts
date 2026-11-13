import { readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
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
const POPUP = `<script>setTimeout(() => window.open("/w/popup-get"), 500)</script>`
const FLOOD = `<script>
  for (let i = 0; i < 5000; i++) { new Image().src = "/w/img" + i; fetch("/w/f" + i).catch(() => {}) }
</script>`
const REFUSED_FETCHES = `<script>fetch("/w/x403a").catch(() => {}); fetch("/w/x403b").catch(() => {})</script>`
const DECOY = `<button data-action="yes" style="position:fixed;right:0;bottom:0;width:360px;height:200px;z-index:1;opacity:0" onclick="fetch('/w/decoy-click')"></button>`
const CLOSED_TEXT = `<!doctype html><title>Jobs</title><h1>Jobs</h1><p>Positions are filled quickly and no longer listed here after a week.</p>`
/** Everything a page can make the browser do besides a plain request: preconnect, speculation prefetch, ping, a form post. */
const reaching = (port: number) => `<link rel="preconnect" href="http://127.0.0.1:${port}">
<script type="speculationrules">{"prefetch":[{"source":"list","urls":["http://127.0.0.1:${port}/speculated"]}]}</script>
<a id="ping" href="/elsewhere.html" ping="/submit">go</a>
<form id="evil" method="post" action="/submit"><input name="x" value="1"></form>
<iframe name="f" style="display:none"></iframe><form id="evil2" method="post" action="/submit" target="f"></form>
<script>
  setTimeout(() => { document.getElementById("evil2").submit(); document.getElementById("evil").submit() }, 800)
  setTimeout(() => document.getElementById("ping").click(), 1200)
</script>`
const LEAK = `<script>document.getElementById("email").addEventListener("input", () => { document.getElementById("gender").value = "2" })</script>`

interface Hit {
  method: string
  path: string
}

let server: Server
let bystander: Server
let origin: string
let bystanderPort = 0
const hits: Hit[] = []
const bystanderTouched: string[] = []

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
      if (url.pathname.startsWith("/w/x403")) return void res.writeHead(403).end("no")
      if (url.pathname.startsWith("/w/")) return void res.writeHead(200).end("ok")
      if (url.pathname === "/site/ok.html") return html(await page("ats/greenhouse.html", WRITES))
      if (url.pathname === "/site/popup.html") return html(await page("ats/greenhouse.html", POPUP))
      if (url.pathname === "/site/flood.html") return html(await page("ats/greenhouse.html", FLOOD))
      if (url.pathname === "/site/refused.html") return html(await page("ats/greenhouse.html", REFUSED_FETCHES))
      if (url.pathname === "/site/decoy.html") return html(await page("ats/greenhouse.html", DECOY))
      if (url.pathname === "/site/reaching.html")
        return html(await page("ats/greenhouse.html", reaching(bystanderPort)))
      if (url.pathname === "/site/closed.html") return html(CLOSED_TEXT)
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
  bystander = createServer((req, res) => {
    bystanderTouched.push(`request ${req.method} ${req.url}`)
    res.writeHead(200).end("ok")
  })
  bystander.on("connection", () => bystanderTouched.push("connection"))
  await new Promise<void>((resolve) => bystander.listen(0, "127.0.0.1", resolve))
  bystanderPort = (bystander.address() as AddressInfo).port
})

test.afterAll(async () => {
  await Promise.all([server, bystander].map((one) => new Promise<void>((resolve) => one.close(() => resolve()))))
})

test.beforeEach(() => {
  hits.length = 0
  bystanderTouched.length = 0
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
    timeoutMs: 60_000,
    offerMs: 15_000,
    settleMs: 500,
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

    expect({ status: result?.status, reasons: result?.reasons, notes: result?.notes }).toMatchObject({
      status: "ok",
      reasons: [],
    })
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
      { id: "closed-text", path: "/site/closed.html" },
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
    expect(by["closed-text"]?.status).toBe("drift")
    expect(by.leaky?.status).toBe("drift")
    expect(by.leaky?.observation?.sensitiveFilled).toBeGreaterThanOrEqual(1)
    expect(by["no-button"]?.status).toBe("drift")
    expect(by["no-button"]?.reasons.join()).toMatch(/apply button/)
    expect(by.removed).toMatchObject({ status: "gone", reasons: ["http 404"] })
    expect(by.moved?.status).toBe("gone")
    expect(by.off).toMatchObject({ status: "skipped", reasons: ["disabled"] })
    // six targets ran with a pause before each but the first
    expect(Date.now() - started).toBeGreaterThanOrEqual(5_000)
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

  test("a popup cannot crash the run, the next target still runs and no profile is left behind", async () => {
    const leftovers = () => new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("skiffr-smoke-")))
    const before = leftovers()
    const results = await runSmoke(
      options(targets({ id: "popup", path: "/site/popup.html" }, { id: "after", path: "/site/ok.html" })),
    )
    expect(results.map((result) => result.status)).toEqual(["ok", "ok"])
    expect(hits.filter((hit) => hit.method !== "GET" && hit.method !== "HEAD")).toEqual([])
    expect([...leftovers()].filter((name) => !before.has(name))).toEqual([])
  })

  test("a page that floods images and fetches is stopped as an error and the run goes on", async () => {
    const results = await runSmoke(
      options(targets({ id: "flood", path: "/site/flood.html" }, { id: "after", path: "/site/ok.html" })),
    )
    expect(results.map((result) => result.status)).toEqual(["error", "ok"])
    expect(results[0]?.reasons).toEqual(["the page sent more than 300 requests"])
    expect(hits.filter((hit) => hit.path.startsWith("/w/f")).length).toBeLessThanOrEqual(300)
  })

  test("the browser has no way out besides the guard: preconnect, prefetch, ping and form posts reach nothing", async () => {
    const results = await runSmoke(options(targets({ id: "reaching", path: "/site/reaching.html" })))
    expect(["ok", "drift"]).toContain(results[0]?.status)
    expect(bystanderTouched).toEqual([])
    expect(hits.filter((hit) => hit.method !== "GET" && hit.method !== "HEAD")).toEqual([])
    expect(submits()).toEqual([])
  })

  test("a button the page draws with the toast's attribute is never clicked", async () => {
    const results = await runSmoke(options(targets({ id: "decoy", path: "/site/decoy.html" })))
    expect(results[0]?.status).toBe("ok")
    expect(hits.some((hit) => hit.path === "/w/decoy-click")).toBe(false)
  })

  test("refusals inside one page are one strike, so the run goes on", async () => {
    const results = await runSmoke(
      options(targets({ id: "refused", path: "/site/refused.html" }, { id: "after", path: "/site/ok.html" })),
    )
    expect(results.map((result) => result.status)).toEqual(["ok", "ok"])
  })
})
