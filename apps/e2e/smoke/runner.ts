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
  /** How long to wait for the extension's fill offer. */
  offerMs?: number
  settleMs: number
  delayMs: number
  driftThreshold: number
  /** Lets a page on a loopback address through, for the runner's own tests. */
  allowLocal: boolean
  loadBaseline: (id: string) => Promise<Baseline | null>
  /** Set to rewrite baselines: called with what the run saw. */
  saveBaseline?: (id: string, baseline: Baseline) => Promise<void>
  /** Requests one target may send to the network before it is stopped as an error. */
  maxRequests?: number
  /** Where the trace of a target that is not ok goes. Traces hold the page itself, so they are only taken on request. */
  traceDir?: string
  log?: (line: string) => void
  today?: () => string
}

const MAX_REQUESTS = 300
const UNEXPECTED = "the runner failed on this target"
const LOAD_FAILED = "the page did not load"
const REQUEST_FAILED = "a page request failed or timed out"

interface PageState {
  doc: { status: number; finalUrl: string } | null
  /** Requests the guard or the network refused: a runner or network problem, not a change of the page. */
  refusals: number
  refusedDocument: boolean
  /** This target already counted as a 429 or 403 strike for its host. */
  struck: boolean
  requests: number
  overBudget: () => void
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
  const targetHost = new URL(target.url).hostname
  const budget = options.maxRequests ?? MAX_REQUESTS
  await context.route("**/*", async (route: Route) => {
    try {
      const request = route.request()
      const url = new URL(request.url())
      if (url.protocol !== "http:" && url.protocol !== "https:") return await route.continue()
      if (request.method() !== "GET" && request.method() !== "HEAD") {
        state.writesAborted++
        return await route.abort()
      }
      const type = request.resourceType()
      if (isTrackerHost(url.hostname) || ["image", "media", "font"].includes(type)) return await route.abort()
      if (state.requests >= budget) {
        state.overBudget()
        return await route.abort()
      }
      state.requests++
      const main = request.isNavigationRequest() && request.frame().parentFrame() === null
      let page: Awaited<ReturnType<Fetcher["fetch"]>>
      try {
        page = await shared.limit(url.host, () => fetcher.fetch(url, request.method(), request.headers()))
      } catch {
        state.refusals++
        return await route.abort()
      }
      if (isRefusal(page.status, type)) {
        if (main) state.refusedDocument = true
        if (url.hostname === targetHost && !state.struck) {
          state.struck = true
          shared.strikes.record(url.hostname)
        }
      }
      if (main && !state.doc) state.doc = { status: page.status, finalUrl: page.url }
      await route.fulfill({ status: page.status, headers: page.headers, body: page.body })
    } catch {
      await route.abort().catch(() => undefined)
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
  const offerMs = options.offerMs ?? Math.min(20_000, options.timeoutMs / 3)

  try {
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: Math.min(30_000, options.timeoutMs) })
  } catch {
    if (state.doc && (state.doc.status === 404 || state.doc.status === 410))
      return done("gone", `http ${state.doc.status}`)
    return done("error", state.refusals > 0 ? REQUEST_FAILED : LOAD_FAILED)
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
    if (state.refusals > 0) return done("error", REQUEST_FAILED)
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

  let baseline: Baseline | null = null
  try {
    baseline = await options.loadBaseline(target.id)
  } catch {
    notes.push("baseline file is invalid")
  }
  const verdict = assess(target, observation, baseline, { threshold: options.driftThreshold })
  return { status: verdict.status, reasons: verdict.reasons, notes: [...notes, ...verdict.notes], observation }
}

const errorVisit = (reason: string): Visit => ({ status: "error", reasons: [reason], notes: [], observation: null })

async function runTarget(target: Target, shared: Shared, options: RunOptions): Promise<TargetResult> {
  const started = Date.now()
  const state: PageState = {
    doc: null,
    refusals: 0,
    refusedDocument: false,
    struck: false,
    requests: 0,
    overBudget: () => undefined,
    writesAborted: 0,
    consoleErrors: 0,
  }
  const dir = mkdtempSync(join(tmpdir(), "skiffr-smoke-"))
  let context: BrowserContext | undefined
  let fetcher: Fetcher | undefined
  let result: Visit = errorVisit(UNEXPECTED)
  try {
    // the proxy points at a closed port and only the mock api is let around it: nothing a page asks the browser to
    // connect to (preconnect, prefetch, speculation rules) reaches a network, every real request is the guard's
    context = await chromium.launchPersistentContext(dir, {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${options.extensionDir}`,
        `--load-extension=${options.extensionDir}`,
        "--proxy-server=http://127.0.0.1:9",
        `--proxy-bypass-list=<-loopback>;127.0.0.1:${new URL(shared.api.url).port}`,
      ],
      userAgent: SMOKE_USER_AGENT,
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
      locale: "en-US",
    })
    shared.api.reset()
    shared.api.onMapFields(answerEverything)
    if (options.traceDir) await context.tracing.start({ screenshots: true, snapshots: true })
    fetcher = await limitNetwork(context, target, state, shared, options)
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }))
    await connect(worker, shared.api)
    const page = await context.newPage()
    context.on("page", (other) => {
      if (other !== page) void other.close().catch(() => undefined)
    })
    page.on("pageerror", () => state.consoleErrors++)
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource|net::ERR/.test(message.text())) state.consoleErrors++
    })
    const timers: NodeJS.Timeout[] = []
    const deadline = new Promise<Visit>((resolve) => {
      timers.push(
        setTimeout(
          () => resolve(errorVisit(`gave up after ${Math.round(options.timeoutMs / 1000)}s`)),
          options.timeoutMs,
        ),
      )
    })
    const overBudget = new Promise<Visit>((resolve) => {
      state.overBudget = () =>
        resolve(errorVisit(`the page sent more than ${options.maxRequests ?? MAX_REQUESTS} requests`))
    })
    result = await Promise.race([visit(target, page, context, state, shared, options), deadline, overBudget]).finally(
      () => timers.forEach(clearTimeout),
    )
  } catch (error) {
    options.log?.(`${target.id}: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`)
    result = errorVisit(UNEXPECTED)
  } finally {
    if (context && options.traceDir) {
      const keep = result.status !== "ok" && result.status !== "gone"
      await context.tracing
        .stop(keep ? { path: join(options.traceDir, `${target.id}.zip`) } : undefined)
        .catch(() => undefined)
    }
    fetcher?.close()
    await context?.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  }

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
        const result = await runTarget(target, shared, options).catch((error): TargetResult => {
          log(`${target.id}: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`)
          return { ...skipped(target, UNEXPECTED), status: "error" }
        })
        if (shared.strikes.stopped() && result.status !== "ok" && result.status !== "drift") result.status = "blocked"
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
