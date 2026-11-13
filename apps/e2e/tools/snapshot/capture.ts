import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Browser, type BrowserContext, chromium } from "@playwright/test"
import { build } from "esbuild"
import { createFetcher } from "./fetcher.ts"
import { createRequestGuard, normalizeHost, urlRefusal } from "./guard.ts"
import { TOOL_VERSION } from "./version.ts"

const DETECT_ENTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "extension",
  "lib",
  "detect",
  "score.ts",
)
export const USER_AGENT = `skiffr-snapshot/${TOOL_VERSION} (+https://github.com/FindMalek/skiffr; developer fixture capture)`

export interface CaptureOptions {
  url: string
  click?: string
  root?: string
  timeoutMs: number
  settleMs: number
  allowLocal: boolean
}

export interface Capture {
  /** A full page around the application area, still unsanitized. */
  html: string
  selector: string
  rootBy: "selector" | "detect" | "largest"
  fields: Record<string, number>
}

type InPage =
  | { error: string }
  | {
      selector: string
      rootBy: Capture["rootBy"]
      outer: string
      title: string
      lang: string
      dir: string
      fields: Record<string, number>
    }

/** Runs in the page: finds the application area and returns a copy with the few style properties the fill checks read baked in. */
function readApplication(rootSelector: string | null): InPage {
  const MAX_ELEMENTS = 20_000
  const CONTROLS = "input, textarea, select"
  const detect = (
    globalThis as unknown as {
      __skiffrDetect?: {
        detectApplicationForm: (d: Document, u: string) => { isForm: boolean; container: Element | null }
      }
    }
  ).__skiffrDetect

  let root: Element | null = null
  let rootBy: "selector" | "detect" | "largest" = "selector"
  if (rootSelector) {
    root = document.querySelector(rootSelector)
    if (!root) return { error: `--root ${rootSelector} matched nothing` }
  } else {
    const found = detect?.detectApplicationForm(document, location.href)
    if (
      found?.isForm &&
      found.container &&
      found.container !== document.body &&
      found.container !== document.documentElement
    ) {
      root = found.container
      rootBy = "detect"
    } else {
      rootBy = "largest"
      let best = 0
      for (const el of Array.from(document.querySelectorAll("form, dialog, [role=dialog], [role=form]"))) {
        const count = el.querySelectorAll(`input:not([type=hidden]), textarea, select`).length
        if (count > best) {
          best = count
          root = el
        }
      }
    }
    if (!root) return { error: "no application form or dialog found: open it with --click or pick it with --root" }
  }

  const tagPath = (target: Element): string => {
    const parts: string[] = []
    for (let node: Element | null = target; node && node !== document.documentElement; node = node.parentElement) {
      const tag = node.localName.replace(/[^a-z0-9-]/g, "")
      const same = node.parentElement
        ? Array.from(node.parentElement.children).filter((c) => c.localName === node?.localName)
        : [node]
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag)
    }
    return parts.join(" > ")
  }

  const source = [root, ...Array.from(root.querySelectorAll("*"))]
  if (source.length > MAX_ELEMENTS) return { error: `the application area has over ${MAX_ELEMENTS} elements` }
  const clone = root.cloneNode(true) as Element
  const copy = [clone, ...Array.from(clone.querySelectorAll("*"))]
  const sized = new Set(["img", "picture", "video", "svg", "iframe", "canvas"])
  const px = (value: string): number => Number.parseFloat(value)

  source.forEach((el, index) => {
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const props: string[] = []
    if (style.display === "none" && !(el.localName === "input" && el.getAttribute("type") === "hidden")) {
      props.push("display:none")
    }
    if (style.visibility !== "visible") props.push(`visibility:${style.visibility}`)
    if (style.opacity !== "1") props.push(`opacity:${style.opacity}`)
    if (style.contentVisibility === "hidden") props.push("content-visibility:hidden")
    if (style.pointerEvents === "none") props.push("pointer-events:none")
    if (/opacity\(\s*0(\.0+)?\s*\)/.test(style.filter)) props.push("filter:opacity(0)")
    const rendered = style.display !== "none" && el.checkVisibility({ visibilityProperty: false })
    if (rendered && style.display !== "contents") {
      const offscreen =
        (style.position === "absolute" || style.position === "fixed") &&
        (px(style.left) <= -1000 || px(style.top) <= -1000)
      const clipped = style.clip.startsWith("rect(") || style.clipPath.startsWith("inset(")
      if (offscreen || clipped) props.push(`position:${style.position}`)
      if (px(style.left) <= -1000) props.push(`left:${style.left}`)
      if (px(style.top) <= -1000) props.push(`top:${style.top}`)
      if (style.clip.startsWith("rect(")) props.push(`clip:${style.clip}`)
      if (style.clipPath.startsWith("inset(")) props.push(`clip-path:${style.clipPath}`)
      const collapsed = rect.width < 2 || rect.height < 2
      if (collapsed || sized.has(el.localName)) {
        props.push(`width:${Math.round(rect.width)}px`, `height:${Math.round(rect.height)}px`)
      }
      if (collapsed || style.maxHeight === "0px") {
        if (style.overflowX !== "visible" || style.overflowY !== "visible") props.push("overflow:hidden")
        if (style.maxHeight === "0px") props.push("max-height:0px")
      }
    }
    const target = copy[index]
    if (props.length > 0) target?.setAttribute("style", props.join(";"))
    else target?.removeAttribute("style")
  })

  for (const el of Array.from(
    clone.querySelectorAll("script, style, noscript, template, link, meta, base, object, embed"),
  ))
    el.remove()

  const fields: Record<string, number> = {}
  for (const el of Array.from(clone.querySelectorAll(CONTROLS))) {
    const tag = el.localName
    const kind = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : tag
    fields[kind] = (fields[kind] ?? 0) + 1
  }
  return {
    selector: tagPath(root),
    rootBy,
    outer: clone.outerHTML,
    title: document.title,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    fields,
  }
}

let detectBundle: Promise<string> | undefined

/** The extension's own application detection, bundled for the page. It reads the dom only and imports nothing from the extension runtime. */
function bundleDetect(): Promise<string> {
  detectBundle ??= build({
    entryPoints: [DETECT_ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__skiffrDetect",
    target: "es2022",
    logLevel: "silent",
  }).then((result) => result.outputFiles[0]?.text ?? "")
  return detectBundle
}

const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;")

/** A page cannot open a channel the request route does not see: no websocket, WebRTC or WebTransport. */
export async function blockRealtime(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    for (const name of ["WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) {
      Object.defineProperty(window, name, { value: undefined, configurable: true })
    }
  })
  await context.routeWebSocket(/.*/, (socket) => socket.close())
}

export async function capture(browser: Browser, options: CaptureOptions): Promise<Capture> {
  const refusal = urlRefusal(options.url)
  if (refusal) throw new Error(refusal)
  const start = new URL(options.url)
  const guard = createRequestGuard({ allowLocal: options.allowLocal, topUrl: options.url })
  const reason = await guard(options.url)
  if (reason) throw new Error(`refusing to snapshot: ${reason} (use --allow-local for a local test page)`)

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block",
    acceptDownloads: false,
    permissions: [],
    locale: "en-US",
  })
  const fetcher = createFetcher({
    guard,
    allowName: options.allowLocal ? normalizeHost(start.hostname) : null,
    timeoutMs: options.timeoutMs,
  })
  try {
    await blockRealtime(context)
    const blocked: string[] = []
    await context.route("**/*", async (route) => {
      const request = route.request()
      if (request.method() !== "GET" && request.method() !== "HEAD") return route.abort()
      if (request.resourceType() === "media" || request.resourceType() === "font") return route.abort()
      try {
        const { status, headers, body } = await fetcher.fetch(
          new URL(request.url()),
          request.method(),
          request.headers(),
        )
        return await route.fulfill({ status, headers, body })
      } catch (error) {
        blocked.push(error instanceof Error ? error.message : String(error))
        return route.abort()
      }
    })
    const page = await context.newPage()
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }).catch((error) => {
      throw new Error(blocked[0] ? `the page was not loaded: ${blocked[0]}` : String(error?.message ?? error))
    })
    const settle = async (): Promise<void> => {
      await page.waitForLoadState("networkidle", { timeout: options.timeoutMs }).catch(() => undefined)
      await page.waitForTimeout(options.settleMs)
    }
    await settle()
    if (options.click) {
      await page.locator(options.click).first().click({ timeout: options.timeoutMs })
      await settle()
    }
    if (!options.root)
      await page.evaluate(`(() => {${await bundleDetect()}\nglobalThis.__skiffrDetect = __skiffrDetect})()`)
    const result = await page.evaluate(readApplication, options.root ?? null)
    if ("error" in result) throw new Error(result.error)
    const lang = result.lang ? ` lang="${esc(result.lang).replace(/"/g, "")}"` : ""
    const dir = result.dir ? ` dir="${esc(result.dir).replace(/"/g, "")}"` : ""
    return {
      html: `<!doctype html><html${lang}${dir}><head><title>${esc(result.title)}</title></head><body>${result.outer}</body></html>`,
      selector: result.selector,
      rootBy: result.rootBy,
      fields: Object.fromEntries(Object.entries(result.fields).sort(([a], [b]) => (a < b ? -1 : 1))),
    }
  } finally {
    fetcher.close()
    await context.close()
  }
}

export const launch = (): Promise<Browser> =>
  chromium.launch({
    headless: true,
    args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-quic"],
  })
