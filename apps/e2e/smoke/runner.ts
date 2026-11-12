import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type BrowserContext, chromium, type Page, type Route } from "@playwright/test"
import type { FieldDescriptor } from "@skiffr/common/schemas"
import { answerEverything } from "../fixtures/adapters.ts"
import { connect } from "../fixtures/application.ts"
import { ToastDriver } from "../fixtures/toast.ts"
import { type MockApi, startMockApi } from "../mock-api/server.ts"
import { blockRealtime } from "../tools/snapshot/capture.ts"
import { createFetcher, type Fetcher } from "../tools/snapshot/fetcher.ts"
import { createRequestGuard, normalizeHost } from "../tools/snapshot/guard.ts"
import {
  assess,
  type Baseline,
  baselineOf,
  matchesAny,
  normalizeLabel,
  type Observation,
  SENSITIVE,
  type TargetResult,
} from "./drift.ts"
import { createHostLimiter, createStrikes, isRefusal, isTrackerHost, SMOKE_USER_AGENT, sleep } from "./polite.ts"
import type { Target } from "./schema.ts"

export interface RunOptions {
  targets: Target[]
  extensionDir: string
  /** Hard limit for one target, in milliseconds. */
  timeoutMs: number
  settleMs: number
  delayMs: number
  driftThreshold: number
  /** Lets a page on a loopback address through, for the runner's own tests. */
  allowLocal: boolean
  loadBaseline: (id: string) => Promise<Baseline | null>
  /** Set to rewrite baselines: called with what the run saw. */
  saveBaseline?: (id: string, baseline: Baseline) => Promise<void>
  /** Where the trace of a target that is not ok goes. */
  traceDir?: string
  log?: (line: string) => void
  today?: () => string
}

interface PageState {
  doc: { status: number; finalUrl: string } | null
  refusals: string[]
  refusedDocument: boolean
  writesAborted: number
  consoleErrors: number
}

interface FormControl {
  key: string
  label: string
  state: string
  /** A text like control with nothing in it. */
  empty: boolean
  /** The radio group the control belongs to, and whether it is the one picked. */
  radio: { name: string; picked: boolean } | null
}

const GONE_TEXT =
  /(job|position|posting|role|page).{0,40}(no longer|not (be )?found|expired|closed|filled|unavailable)|no longer (accepting|available)|can.?t be found|could not be found/i

/** In the page: every control with the words that name it and what it holds. Read before and after the fill to see what it changed. */
function readControls(): FormControl[] {
  const text = (el: Element | null | undefined): string =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300)
  const CONTROLS = "input:not([type=hidden]), select, textarea"
  const out: FormControl[] = []
  const nodes = Array.from(
    document.querySelectorAll(`${CONTROLS}, [role=combobox], [role=radio], [role=checkbox], button[aria-pressed]`),
  )
  nodes.forEach((el, index) => {
    const input = el as HTMLInputElement
    if (["file", "submit", "button", "image", "reset", "search"].includes(input.type)) return
    if (input.disabled || !(el as HTMLElement).checkVisibility()) return
    const parts: string[] = []
    for (const label of Array.from(input.labels ?? [])) parts.push(text(label))
    parts.push(el.getAttribute("aria-label") ?? "", input.name ?? "", el.id, input.placeholder ?? "")
    for (const id of (el.getAttribute("aria-labelledby") ?? "").split(/\s+/))
      parts.push(text(document.getElementById(id)))
    parts.push(text(el.closest("fieldset")?.querySelector("legend")))
    const group = input.name ? document.getElementsByName(input.name).length : 1
    let row: Element | null = el.parentElement
    let best: Element | null = null
    for (let depth = 0; row && depth < 4 && row.querySelectorAll(CONTROLS).length <= group + 1; depth++) {
      best = row
      row = row.parentElement
    }
    parts.push(text(best))
    const shown = text(best?.querySelector("[class*=single-value], [class*=singleValue]"))
    const state = [
      input.type === "checkbox" || input.type === "radio" ? String(input.checked) : (input.value ?? ""),
      el.getAttribute("aria-pressed") ?? "",
      el.getAttribute("aria-checked") ?? "",
      shown,
    ].join("|")
    const isRadio = input.type === "radio" && Boolean(input.name)
    const isTextLike =
      !["checkbox", "radio"].includes(input.type) &&
      !el.hasAttribute("aria-pressed") &&
      !el.hasAttribute("aria-checked")
    out.push({
      key: `${el.id || input.name || ""}#${index}`,
      label: parts.join(" "),
      state,
      empty: isTextLike && !input.value && !shown,
      radio: isRadio ? { name: input.name, picked: input.checked } : null,
    })
  })
  return out
}

function changed(before: FormControl[], after: FormControl[]): FormControl[] {
  const was = new Map(before.map((control) => [control.key, control.state]))
  return after.filter((control) => was.has(control.key) && was.get(control.key) !== control.state)
}

function unfilled(controls: FormControl[]): number {
  const groups = new Map<string, boolean>()
  for (const control of controls) {
    if (control.radio) groups.set(control.radio.name, (groups.get(control.radio.name) ?? false) || control.radio.picked)
  }
  return controls.filter((control) => control.empty).length + [...groups.values()].filter((picked) => !picked).length
}

type Asked = Pick<FieldDescriptor, "label" | "name" | "ariaLabel" | "type">

const labelOf = (field: Asked): string => field.label || field.ariaLabel || field.name || ""

function askedFields(api: MockApi): Asked[] {
  const seen = new Map<string, Asked>()
  for (const request of api.requests) {
    if (request.path !== "/rpc/ai/mapFields") continue
    for (const field of (request.body as { fields: (Asked & { id: string })[] }).fields) seen.set(field.id, field)
  }
  return [...seen.values()]
}

function lookedUpLabels(api: MockApi): string[] {
  return api.requests
    .filter((request) => request.path === "/rpc/learning/lookup")
    .flatMap((request) => (request.body as { fields: { label: string }[] }).fields.map((field) => field.label))
}

function parseToast(title: string): { filled: number; outlined: number } {
  const filled = /Filled (\d+) field/.exec(title)
  const nothing = /Nothing filled\. (\d+) suggestion/.exec(title)
  const outlined = /(\d+) outlined/.exec(title)
  return { filled: Number(filled?.[1] ?? 0), outlined: Number(outlined?.[1] ?? nothing?.[1] ?? 0) }
}

const pathOf = (url: string): string => new URL(url).pathname.replace(/\/+$/, "").toLowerCase()

interface Shared {
  api: MockApi
  limit: ReturnType<typeof createHostLimiter>
  strikes: ReturnType<typeof createStrikes>
}

async function limitNetwork(
  context: BrowserContext,
  target: Target,
  state: PageState,
  shared: Shared,
  options: RunOptions,
) {
  const guard = createRequestGuard({ allowLocal: options.allowLocal, topUrl: target.url })
  const fetcher: Fetcher = createFetcher({
    guard,
    allowName: options.allowLocal ? normalizeHost(new URL(target.url).hostname) : null,
    timeoutMs: Math.min(30_000, options.timeoutMs),
  })
  await blockRealtime(context)
  await context.route("**/*", async (route: Route) => {
    const request = route.request()
    let url: URL
    try {
      url = new URL(request.url())
    } catch {
      return route.abort()
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return route.continue()
    const readPost =
      request.method() === "POST" &&
      url.host === new URL(target.url).host &&
      target.readPosts.includes(`${url.pathname}${url.search}`)
    if (request.method() !== "GET" && request.method() !== "HEAD" && !readPost) {
      state.writesAborted++
      return route.abort()
    }
    if (isTrackerHost(url.hostname) || ["image", "media", "font"].includes(request.resourceType())) return route.abort()
    const main = request.isNavigationRequest() && request.frame().parentFrame() === null
    try {
      const page = await shared.limit(url.host, () =>
        fetcher.fetch(url, request.method(), request.headers(), request.postDataBuffer() ?? undefined),
      )
      if (isRefusal(page.status, request.resourceType())) {
        shared.strikes.record(url.hostname)
        if (main) state.refusedDocument = true
      }
      if (main && !state.doc) state.doc = { status: page.status, finalUrl: page.url }
      return await route.fulfill({ status: page.status, headers: page.headers, body: page.body })
    } catch (error) {
      state.refusals.push(error instanceof Error ? error.message : String(error))
      return route.abort()
    }
  })
  return fetcher
}

async function settle(page: Page, options: RunOptions): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, options.timeoutMs) }).catch(() => undefined)
  await page.waitForTimeout(options.settleMs)
}

const blank = (): Omit<Observation, "fields" | "handled"> => ({
  toast: false,
  collected: 0,
  filled: 0,
  outlined: 0,
  left: 0,
  sensitiveAsked: 0,
  sensitiveFilled: 0,
  consoleErrors: 0,
  clickMissed: false,
})

interface Visit {
  status: TargetResult["status"]
  reasons: string[]
  notes: string[]
  observation: Observation | null
}

async function visit(
  target: Target,
  page: Page,
  context: BrowserContext,
  state: PageState,
  shared: Shared,
  options: RunOptions,
): Promise<Visit> {
  const done = (status: Visit["status"], reason: string, observation: Observation | null = null): Visit => ({
    status,
    reasons: [reason],
    notes: [],
    observation,
  })
  const offerMs = Math.min(20_000, options.timeoutMs / 3)

  try {
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: Math.min(30_000, options.timeoutMs) })
  } catch (error) {
    if (state.doc && (state.doc.status === 404 || state.doc.status === 410))
      return done("gone", `http ${state.doc.status}`)
    return done(
      "error",
      state.refusals[0] ?? (error instanceof Error ? (error.message.split("\n")[0] ?? "load failed") : "load failed"),
    )
  }
  const doc = state.doc
  if (state.refusedDocument || (doc && (doc.status === 429 || doc.status === 403)))
    return done("blocked", `http ${doc?.status ?? 429}`)
  if (doc && (doc.status === 404 || doc.status === 410)) return done("gone", `http ${doc.status}`)
  if (doc && doc.status >= 400) return done("error", `http ${doc.status}`)
  if (doc && pathOf(doc.finalUrl) !== pathOf(target.url)) return done("gone", "redirected away from the posting")

  await page.bringToFront()
  await settle(page, options)
  let clickMissed = false
  if (target.click) {
    try {
      await page
        .locator(target.click)
        .first()
        .click({ timeout: Math.min(10_000, options.timeoutMs / 4) })
      await settle(page, options)
    } catch {
      clickMissed = true
    }
  }

  const toast = await ToastDriver.attach(context, page)
  const offered = await toast
    .waitFor((snapshot) => snapshot.buttons.some((button) => button.action === "yes"), offerMs)
    .then(() => true)
    .catch(() => false)

  const observation: Observation = {
    ...blank(),
    fields: [],
    handled: [],
    toast: offered,
    clickMissed,
    consoleErrors: state.consoleErrors,
  }
  const notes: string[] = []
  if (!offered) {
    const closed = await page
      .evaluate((source) => new RegExp(source, "i").test(document.body.innerText.slice(0, 6000)), GONE_TEXT.source)
      .catch(() => false)
    if (closed && !clickMissed) return done("gone", "the page says the posting is closed")
  } else {
    const before = await page.evaluate(readControls)
    await toast.click("yes")
    const result = await toast
      .waitFor(
        (snapshot) =>
          snapshot.title !== null &&
          !snapshot.title.startsWith("Filling") &&
          !snapshot.buttons.some((button) => button.action === "yes"),
        45_000,
      )
      .catch(() => null)
    const after = await page.evaluate(readControls)
    const title = result?.title ?? ""
    const counts = parseToast(title)
    if (!/^(Filled|Nothing)/.test(title)) notes.push(`toast: ${title.slice(0, 80) || "none"}`)

    const asked = askedFields(shared.api)
    const sensitive = (label: string): boolean => SENSITIVE.test(label) || matchesAny(label, target.expect.untouched)
    const askedLabels = asked.map((field) => normalizeLabel(labelOf(field)))
    const touched = changed(before, after)
    const unasked = touched.filter((control) => {
      const text = normalizeLabel(control.label)
      return !askedLabels.some((label) => label !== "" && text.includes(label))
    })
    observation.fields = asked.map((field) => ({
      label: labelOf(field),
      type: field.type ?? "",
    }))
    observation.handled = [...askedLabels, ...unasked.map((control) => control.label)]
    observation.collected = observation.handled.length
    observation.filled = counts.filled
    observation.outlined = counts.outlined
    observation.left = unfilled(after)
    observation.sensitiveAsked =
      asked.filter((field) => sensitive(`${field.label} ${field.name} ${field.ariaLabel}`)).length +
      lookedUpLabels(shared.api).filter(sensitive).length
    observation.sensitiveFilled = touched.filter((control) => sensitive(control.label)).length
  }
  observation.consoleErrors = state.consoleErrors

  const baseline = await options.loadBaseline(target.id)
  const verdict = assess(target, observation, baseline, { threshold: options.driftThreshold })
  return { status: verdict.status, reasons: verdict.reasons, notes: [...notes, ...verdict.notes], observation }
}

async function runTarget(target: Target, shared: Shared, options: RunOptions): Promise<TargetResult> {
  const started = Date.now()
  const state: PageState = { doc: null, refusals: [], refusedDocument: false, writesAborted: 0, consoleErrors: 0 }
  const dir = mkdtempSync(join(tmpdir(), "skiffr-smoke-"))
  const context = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${options.extensionDir}`, `--load-extension=${options.extensionDir}`],
    userAgent: SMOKE_USER_AGENT,
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block",
    acceptDownloads: false,
    permissions: [],
    locale: "en-US",
  })
  let fetcher: Fetcher | undefined
  let result: Visit
  try {
    shared.api.reset()
    shared.api.onMapFields(answerEverything)
    if (options.traceDir) await context.tracing.start({ screenshots: true, snapshots: true })
    fetcher = await limitNetwork(context, target, state, shared, options)
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }))
    await connect(worker, shared.api)
    const page = await context.newPage()
    page.on("pageerror", () => state.consoleErrors++)
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource|net::ERR/.test(message.text())) state.consoleErrors++
    })
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<Visit>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            status: "error",
            reasons: [`gave up after ${Math.round(options.timeoutMs / 1000)}s`],
            notes: [],
            observation: null,
          }),
        options.timeoutMs,
      )
    })
    result = await Promise.race([visit(target, page, context, state, shared, options), deadline]).finally(() =>
      clearTimeout(timer),
    )
  } catch (error) {
    result = {
      status: "error",
      reasons: [error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : "failed"],
      notes: [],
      observation: null,
    }
  }

  if (options.traceDir) {
    const keep = result.status !== "ok" && result.status !== "gone"
    await context.tracing
      .stop(keep ? { path: join(options.traceDir, `${target.id}.zip`) } : undefined)
      .catch(() => undefined)
  }
  fetcher?.close()
  await context.close().catch(() => undefined)
  rmSync(dir, { recursive: true, force: true })

  const {
    fields: _fields,
    handled: _handled,
    ...counts
  } = result.observation ?? { ...blank(), fields: [], handled: [] }
  const notes = [...result.notes]
  const seen = result.observation
  const clean = seen && seen.sensitiveAsked === 0 && seen.sensitiveFilled === 0
  if (seen?.toast && clean && seen.filled >= target.expect.minFilled && options.saveBaseline) {
    await options.saveBaseline(
      target.id,
      baselineOf(seen, (options.today ?? (() => new Date().toISOString().slice(0, 10)))()),
    )
    notes.push("baseline updated")
  }
  return {
    id: target.id,
    ats: target.ats,
    status: result.status,
    reasons: result.reasons,
    notes,
    observation: result.observation ? counts : null,
    writesAborted: state.writesAborted,
    ms: Date.now() - started,
  }
}

export async function runSmoke(options: RunOptions): Promise<TargetResult[]> {
  if (!existsSync(join(options.extensionDir, "manifest.json"))) {
    throw new Error(
      `no built extension at ${options.extensionDir}: run \`pnpm --filter extension build\` or set E2E_EXTENSION_DIR`,
    )
  }
  const log = options.log ?? (() => undefined)
  const api = await startMockApi()
  const shared: Shared = { api, limit: createHostLimiter(), strikes: createStrikes() }
  const results: TargetResult[] = []
  const skipped = (target: Target, reason: string): TargetResult => ({
    id: target.id,
    ats: target.ats,
    status: "skipped",
    reasons: [reason],
    notes: [],
    observation: null,
    writesAborted: 0,
    ms: 0,
  })
  try {
    let ran = false
    for (const target of options.targets) {
      const stoppedBy = shared.strikes.stopped()
      if (!target.enabled) results.push(skipped(target, "disabled"))
      else if (stoppedBy) results.push(skipped(target, `run stopped: ${stoppedBy} answered 429 or 403 twice`))
      else {
        if (ran) await sleep(options.delayMs)
        ran = true
        const result = await runTarget(target, shared, options)
        const stopped = shared.strikes.stopped()
        if (stopped && result.status !== "ok" && result.status !== "drift") result.status = "blocked"
        results.push(result)
      }
      const last = results.at(-1) as TargetResult
      log(`${last.id}: ${last.status}${last.reasons[0] ? ` (${last.reasons[0]})` : ""}`)
    }
  } finally {
    await api.stop()
  }
  return results
}
