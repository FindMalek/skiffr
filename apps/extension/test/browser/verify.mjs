// Real browser checks for the form detector and toast. Not part of `bun test`.
//
//   pnpm --filter extension exec wxt build --mode development
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME_PATH="/path/to/Chrome for Testing" \
//     node apps/extension/test/browser/verify.mjs
//
// Local mode serves test/fixtures over https and maps every hostname to 127.0.0.1, so ats hostnames
// such as job-boards.greenhouse.io hit the fixtures. LIVE_URLS="url1 url2" loads real pages instead
// (load only, no typing, no clicks) and reports whether the toast appeared.
//
// The dev build writes data-skiffr-fills on <html> of every frame that was asked to fill, that is how
// this script sees which frames got a `fill` message.

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:https"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, "../fixtures")
const EXTENSION = process.env.EXTENSION_DIR ?? join(HERE, "../../.output/chrome-mv3-dev")
// PLAYWRIGHT_CORE is the package directory (or its index.mjs); node 24 will not import a bare directory
const core = process.env.PLAYWRIGHT_CORE
const specifier = core ? pathToFileURL(core.endsWith(".mjs") ? core : join(core, "index.mjs")).href : "playwright-core"
const playwright = await import(specifier)
const chromium = playwright.chromium ?? playwright.default.chromium

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` ${extra}` : ""}`)
  if (!ok) failures++
}

// some ats domains are hsts preloaded, so the fixtures are served over https with a throwaway certificate
const certDir = mkdtempSync(join(tmpdir(), "skiffr-cert-"))
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-keyout",
    join(certDir, "key.pem"),
    "-out",
    join(certDir, "cert.pem"),
  ],
  { stdio: "ignore" },
)
const tls = { key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }
rmSync(certDir, { recursive: true, force: true })

const requests = []

function serve(ports) {
  return createServer(tls, (req, res) => {
    const url = new URL(req.url, "http://x")
    requests.push({ path: url.pathname + url.search, purpose: String(req.headers["sec-purpose"] ?? "") })
    const name = url.searchParams.get("f") ?? basename(url.pathname).replace(/\.html$/, "")
    try {
      const html = readFileSync(join(FIXTURES, `${name}.html`), "utf8")
        .replaceAll("ATTACKER_PORT", String(ports.attacker))
        .replaceAll("PORT", String(ports.main))
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
    } catch {
      res.writeHead(404).end("not found")
    }
  })
}

async function launch(args = [], { bfcache = false } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "skiffr-verify-"))
  const context = await chromium.launchPersistentContext(profile, {
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: bfcache ? ["--disable-back-forward-cache"] : [],
    executablePath: process.env.CHROME_PATH,
    headless: false,
    viewport: { width: 1100, height: 800 },
    args: [
      "--headless=new",
      "--ignore-certificate-errors",
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      ...args,
    ],
  })
  let [worker] = context.serviceWorkers()
  worker ??= await context.waitForEvent("serviceworker")
  return {
    context,
    worker,
    close: async () => {
      await context.close()
      rmSync(profile, { recursive: true, force: true })
    },
  }
}

const hostsIn = () =>
  [...document.documentElement.children]
    .filter((el) => /^X-[A-Z0-9]{8}$/.test(el.tagName))
    .map((el) => {
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, connected: el.isConnected }
    })

const toasts = (page) => page.evaluate(hostsIn)
async function waitToast(page, ms) {
  for (let waited = 0; waited <= ms; waited += 100) {
    const [toast] = await toasts(page)
    if (toast && toast.w > 0) return toast
    await sleep(100)
  }
  return null
}
const fills = (frame) => frame.evaluate(() => Number(document.documentElement.dataset.skiffrFills ?? 0))
const clickOffset = { yes: [42, 62], no: [101, 62], never: [240, 62] }
async function clickToast(page, button) {
  const toast = await waitToast(page, 2000)
  if (!toast) return
  const [dx, dy] = clickOffset[button]
  await page.mouse.click(toast.x + dx, toast.y + dy)
}
const childFrame = (page) => page.frames().find((frame) => frame !== page.mainFrame() && frame.url().startsWith("http"))

const ports = { main: 0, attacker: 0 }
const mainServer = serve(ports)
const attackerServer = serve(ports)
await new Promise((resolve) => mainServer.listen(0, "127.0.0.1", resolve))
await new Promise((resolve) => attackerServer.listen(0, "127.0.0.1", resolve))
ports.main = mainServer.address().port
ports.attacker = attackerServer.address().port
const at = (host, path) => `https://${host}:${ports.main}${path}`

if (process.env.LIVE_URLS) {
  const { context, close } = await launch()
  for (const url of process.env.LIVE_URLS.split(/\s+/).filter(Boolean)) {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: "load" })
    const toast = await waitToast(page, 9000)
    check(`live: toast on ${url}`, toast !== null, JSON.stringify(await toasts(page)))
    if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, `live-${new URL(url).hostname}.png`) })
    await page.close()
  }
  await close()
  mainServer.close()
  attackerServer.close()
  process.exit(failures ? 1 : 0)
}

const { context, worker, close } = await launch(["--host-resolver-rules=MAP * 127.0.0.1"])
await worker.evaluate(() => {
  globalThis.formDetected = {}
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "form-detected")
      globalThis.formDetected[sender.frameId] = (globalThis.formDetected[sender.frameId] ?? 0) + 1
  })
})
const open = async (url) => {
  const page = await context.newPage()
  await page.goto(url, { waitUntil: "load" })
  return page
}
const shot = async (page, name) =>
  process.env.SHOTS && (await page.screenshot({ path: join(process.env.SHOTS, `${name}.png`) }))

// positives and negatives
const POSITIVE = [
  ["greenhouse", at("job-boards.greenhouse.io", "/acme/jobs/1?f=greenhouse")],
  ["lever", at("jobs.lever.co", "/acme/abc/apply?f=lever")],
  ["ashby", at("jobs.ashbyhq.com", "/acme/abc/application?f=ashby")],
  ["workable", at("apply.workable.com", "/acme/j/ABC/apply/?f=workable")],
  ["generic careers form", at("careers.initech.test", "/apply?f=careers-generic")],
]
const NEGATIVE = [
  ["newsletter", "newsletter"],
  ["login", "login"],
  ["search", "search"],
  ["checkout", "checkout"],
  ["jobs/contact form", "jobs-contact"],
  ["loan application", "loan-application"],
  ["application support", "application-support"],
]
await Promise.all(
  POSITIVE.map(async ([name, url]) => {
    const page = await open(url)
    check(`toast on ${name}`, (await waitToast(page, 4000)) !== null)
    await page.close()
  }),
)
await Promise.all(
  NEGATIVE.map(async ([name, fixture]) => {
    const page = await open(at("acme.test", `/jobs/${fixture}?f=${fixture}`))
    await sleep(2500)
    check(`no toast on ${name}`, (await toasts(page)).length === 0)
    await page.close()
  }),
)

// blocker 1: greenhouse replaces <html> ~1.3s after load
{
  const page = await open(at("job-boards.greenhouse.io", "/acme/jobs/1?f=greenhouse-swap"))
  await sleep(5000)
  const swapped = await page.evaluate(() => window.__swapped === true)
  const all = await toasts(page)
  check("greenhouse html swap: page really swapped <html>", swapped)
  check(
    "greenhouse html swap: exactly one connected toast at 5s",
    all.length === 1 && all[0].connected && all[0].w > 0,
    JSON.stringify(all),
  )
  await shot(page, "toast-after-html-swap")
  await clickToast(page, "yes")
  check("greenhouse html swap: yes still fills", (await fills(page.mainFrame())) === 1)
  await page.close()
}

// blocker 2: ashby renders its form from js after 2.5s, with free text questions
{
  const page = await open(at("jobs.ashbyhq.com", "/acme/abc/application?f=ashby-late"))
  check("ashby late render: no toast before the form exists", (await toasts(page)).length === 0)
  check("ashby late render: toast after the form renders", (await waitToast(page, 6000)) !== null)
  await page.close()
}

// blocker 4: a 100ms ticker must not starve detection, form arrives at 3s
{
  const page = await open(at("careers.initech.test", "/careers?f=ticker"))
  check("ticker page: toast for a form inserted at 3s", (await waitToast(page, 7000)) !== null)
  await page.close()
}

// custom domain, the form is revealed by clicking Apply
{
  const page = await open(at("careers.initech.test", "/jobs/designer?f=teamtailor-apply-click"))
  await sleep(1500)
  check("apply click page: no toast before the click", (await toasts(page)).length === 0)
  await page.click("#apply")
  check("apply click page: toast after the click", (await waitToast(page, 4000)) !== null)
  await page.close()
}

// blocker 3: a frame on another origin must never be asked to fill
{
  const page = await open(at("weather.test", "/?f=attacker-parent"))
  await sleep(3000)
  check("attacker frame alone: no toast in the top frame", (await toasts(page)).length === 0)
  await page.close()
}
{
  const page = await open(at("careers.initech.test", "/apply?f=attacker-and-form"))
  await clickToast(page, "yes")
  await sleep(800)
  const ad = childFrame(page)
  check("attacker frame next to a real form: top frame filled", (await fills(page.mainFrame())) === 1)
  check(
    "attacker frame next to a real form: attacker frame never got fill",
    ad !== undefined && (await fills(ad)) === 0,
  )
  await page.close()
}

// an ats frame embedded on another origin is still filled, with one toast
{
  const page = await open(at("careers.initech.test", "/careers?f=careers-embed"))
  await sleep(1500)
  const embedToasts = await waitToast(page, 4000)
  const frame = page.frames().find((f) => f.url().includes("boards.greenhouse.io"))
  check("greenhouse embed: one toast, in the top frame", embedToasts !== null && (await toasts(page)).length === 1)
  await shot(page, "toast-iframe")
  await clickToast(page, "yes")
  await sleep(800)
  check("greenhouse embed: yes fills the embed frame", frame !== undefined && (await fills(frame)) === 1)
  await page.close()
}

// a frame that leaves for another origin after reporting is never filled, and the toast for it goes away
{
  const page = await open(at("careers.initech.test", "/?f=nav-parent"))
  const toast = await waitToast(page, 3000)
  check("frame navigated away: toast shown for the same origin frame's form", toast !== null)
  let moved
  for (let waited = 0; !moved && waited < 8000; waited += 200) {
    await sleep(200)
    moved = page.frames().find((frame) => frame.url().includes("newsletter"))
  }
  let gone = false
  for (let waited = 0; !gone && waited < 4000; waited += 200) {
    await sleep(200)
    gone = (await toasts(page)).length === 0
  }
  check("frame navigated away: the toast for the frame's form is withdrawn", gone)
  check(
    "frame navigated away: the frame at the other origin got 0 fill",
    moved !== undefined && (await fills(moved)) === 0,
  )
  await page.close()
}

// blocker: records must not outlive the page, an embed page then a newsletter page in the same tab
{
  const page = await open(at("careers.initech.test", "/careers?f=careers-embed"))
  check("same tab: toast on the embed page", (await waitToast(page, 4000)) !== null)
  await page.goto(at("acme.test", "/blog?f=newsletter"), { waitUntil: "load" })
  await sleep(2500)
  check("same tab: no toast on the newsletter page that follows", (await toasts(page)).length === 0)
  await page.close()
}

// same document url changes must not wipe what the embed reported
{
  const records = async () => {
    const { frameReports = {} } = await worker.evaluate(() => chrome.storage.session.get("frameReports"))
    return JSON.stringify(
      Object.values(frameReports).map((tab) =>
        Object.entries(tab.frames).map(([id, rec]) => [id, rec.documentId, rec.url]),
      ),
    )
  }
  const page = await open(at("careers.initech.test", "/careers?f=careers-embed"))
  check("same document changes: toast on the embed page", (await waitToast(page, 4000)) !== null)
  const frame = page.frames().find((f) => f.url().includes("boards.greenhouse.io"))
  await sleep(2500)
  const before = await records()
  await page.evaluate(() => {
    history.replaceState({}, "", "?replaced=1")
    history.pushState({}, "", "?pushed=1")
    location.hash = "#apply"
  })
  await sleep(600)
  check("same document changes: toast is back after the url changes", (await waitToast(page, 4000)) !== null)
  check(
    "same document changes: the stored frame records are unchanged",
    before !== "[]" && (await records()) === before,
    before,
  )
  await clickToast(page, "yes")
  await sleep(800)
  check("same document changes: yes still fills the embed frame", frame !== undefined && (await fills(frame)) === 1)
  await page.close()
}

// race: the same tab flips between an embed page and a newsletter page, no stale toast and no missed toast
{
  const page = await context.newPage()
  let wrong = 0
  for (let round = 0; round < 20; round++) {
    await page.goto(at("careers.initech.test", `/careers?f=careers-embed&n=${round}`), { waitUntil: "load" })
    if ((await waitToast(page, 5000)) === null) wrong++
    await page.goto(at("acme.test", `/blog?f=newsletter&n=${round}`), { waitUntil: "load" })
    await sleep(900)
    if ((await toasts(page)).length > 0) wrong++
  }
  check("race: 20 alternating navigations, embed always shows and newsletter never does", wrong === 0, `wrong=${wrong}`)
  await page.close()
}

// flood control: a pushState loop in a frame
{
  const page = await open(at("weather.test", "/?f=attacker-parent&flood=1"))
  await sleep(5000)
  const counts = await worker.evaluate(() => globalThis.formDetected)
  const worst = Math.max(
    0,
    ...Object.entries(counts)
      .filter(([frame]) => frame !== "0")
      .map(([, n]) => n),
  )
  check("flood: a looping frame sends at most 3 form-detected in 5s", worst <= 3, JSON.stringify(counts))
  await page.close()
}

// don't ask is per company on a multi tenant ats host
{
  const acme = at("job-boards.greenhouse.io", "/acme/jobs/1?f=greenhouse")
  const page = await open(acme)
  await clickToast(page, "never")
  await sleep(300)
  const stored = await worker.evaluate(() => chrome.storage.local.get("disabledSites"))
  check(
    "dont ask stores host plus first path segment",
    JSON.stringify(stored.disabledSites) === '["job-boards.greenhouse.io/acme"]',
    JSON.stringify(stored),
  )
  await page.reload({ waitUntil: "load" })
  await sleep(2000)
  check("dont ask holds for that company after reload", (await toasts(page)).length === 0)
  await page.goto(at("job-boards.greenhouse.io", "/other/jobs/1?f=greenhouse"), { waitUntil: "load" })
  check("dont ask does not silence another company", (await waitToast(page, 3000)) !== null)
  await page.close()
}

// page css cannot restyle the toast
{
  const page = await open(at("careers.initech.test", "/apply?f=hostile-css"))
  const toast = await waitToast(page, 4000)
  check("hostile css: toast keeps its size", toast !== null && Math.round(toast.w) === 320, JSON.stringify(toast))
  await shot(page, "toast-hostile-css")
  await page.close()
}

await close()

// Playwright turns the back/forward cache off, so this check runs in its own browser with it on
{
  const cached = await launch(["--host-resolver-rules=MAP * 127.0.0.1"], { bfcache: true })
  const page = await cached.context.newPage()
  await page.goto(at("careers.initech.test", "/careers?f=careers-embed"), { waitUntil: "load" })
  check("bfcache: toast on the embed page", (await waitToast(page, 4000)) !== null)
  await page.evaluate(() => {
    window.__persisted = null
    window.addEventListener("pageshow", (event) => {
      window.__persisted = event.persisted
    })
  })
  await page.goto(at("acme.test", "/blog?f=newsletter"), { waitUntil: "load" })
  await sleep(1500)
  check("bfcache: no toast on the newsletter page", (await toasts(page)).length === 0)
  // a page restored from the cache fires no load event
  await page.goBack({ waitUntil: "commit" })
  await sleep(1000)
  check("bfcache: the embed page was restored from the cache", (await page.evaluate(() => window.__persisted)) === true)
  check("bfcache: toast is shown again on the restored page", (await waitToast(page, 4000)) !== null)
  // Playwright does not list a child frame restored from the cache, so the worker's own sends are the evidence
  await cached.worker.evaluate(() => {
    globalThis.fillSends = []
    const send = chrome.tabs.sendMessage.bind(chrome.tabs)
    chrome.tabs.sendMessage = async (tabId, message, options) => {
      const entry = { type: message?.type, options }
      globalThis.fillSends.push(entry)
      try {
        const result = await send(tabId, message, options)
        entry.delivered = true
        return result
      } catch (error) {
        entry.delivered = false
        throw error
      }
    }
  })
  await clickToast(page, "yes")
  await sleep(1000)
  const sends = await cached.worker.evaluate(() => globalThis.fillSends.filter((entry) => entry.type === "fill"))
  const { frameReports = {} } = await cached.worker.evaluate(() => chrome.storage.session.get("frameReports"))
  const recorded = Object.values(frameReports).flatMap((tab) => Object.entries(tab.frames))
  const [frameId, record] = recorded[0] ?? []
  check(
    "bfcache: yes sends fill to the restored embed frame with its documentId, and it is delivered",
    recorded.length === 1 &&
      sends.some(
        (entry) =>
          entry.options?.frameId === Number(frameId) &&
          entry.options?.documentId === record.documentId &&
          entry.delivered,
      ),
    JSON.stringify(sends),
  )
  await page.close()
  await cached.close()
}

// prerender: reports from a prerendered page are ignored until it is activated, then it must start over
{
  const mark = requests.length
  const prerendered = await launch(["--host-resolver-rules=MAP * 127.0.0.1"])
  const page = await prerendered.context.newPage()
  await page.goto(at("careers.initech.test", "/?f=prerender-source"), { waitUntil: "load" })
  await sleep(3000)
  await prerendered.worker.evaluate(() => {
    globalThis.fillSends = []
    const send = chrome.tabs.sendMessage.bind(chrome.tabs)
    chrome.tabs.sendMessage = async (tabId, message, options) => {
      const entry = { type: message?.type, options }
      globalThis.fillSends.push(entry)
      try {
        const result = await send(tabId, message, options)
        entry.delivered = true
        return result
      } catch (error) {
        entry.delivered = false
        throw error
      }
    }
  })
  await page.click("#go")
  await page.waitForURL(/careers/)
  // the browser fetched the page as a prerender and the click reused it instead of loading it again
  const loads = requests.slice(mark).filter((request) => request.path === "/careers?f=careers-embed")
  check(
    "prerender: the page was really prerendered and activated",
    loads.length === 1 && loads[0].purpose.includes("prerender"),
    JSON.stringify(loads),
  )
  check("prerender: toast is shown after activation", (await waitToast(page, 5000)) !== null)
  await clickToast(page, "yes")
  await sleep(1000)
  const sends = await prerendered.worker.evaluate(() => globalThis.fillSends.filter((entry) => entry.type === "fill"))
  check(
    "prerender: yes is delivered to the embed frame after activation",
    sends.some((entry) => entry.options?.frameId > 0 && entry.delivered),
    JSON.stringify(sends),
  )
  await page.close()
  await prerendered.close()
}

mainServer.close()
attackerServer.close()
console.log(failures ? `${failures} FAILED` : "ALL PASS")
process.exit(failures ? 1 : 0)
