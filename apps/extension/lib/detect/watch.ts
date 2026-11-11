import { type Detection, detectApplicationForm } from "./score"

export type FormWatcher = { start: () => void; rearm: () => void; stop: () => void }

type WatchOptions = {
  doc: Document
  onDetect: (detection: Detection) => void
  check?: (doc: Document) => Detection
  throttleMs?: number
  budgetMs?: number
  rearmMs?: number
  recheckMs?: number[]
}

// frames that are still being laid out (cross origin iframes, background tabs) can look hidden on the first pass
const DEFAULTS = { throttleMs: 400, budgetMs: 15_000, rearmMs: 3_000, recheckMs: [600, 2_000] }
const IDLE_TIMEOUT_MS = 1_500
const OBSERVED_ATTRIBUTES = ["hidden", "style", "class", "open", "aria-hidden"]

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

export function createFormWatcher(options: WatchOptions): FormWatcher {
  const { doc, onDetect, check = (target) => detectApplicationForm(target) } = options
  const { throttleMs, budgetMs, rearmMs, recheckMs } = { ...DEFAULTS, ...options }
  let observer: MutationObserver | null = null
  let pending: ReturnType<typeof setTimeout> | undefined
  let budget: ReturnType<typeof setTimeout> | undefined
  let rechecks: ReturnType<typeof setTimeout>[] = []
  let decided = false
  let generation = 0

  function disconnect(): void {
    observer?.disconnect()
    observer = null
    clearTimeout(pending)
    pending = undefined
    clearTimeout(budget)
    for (const timer of rechecks) clearTimeout(timer)
    rechecks = []
  }

  function evaluate(): void {
    const detection = check(doc)
    if (!detection.isForm) return
    decided = true
    disconnect()
    onDetect(detection)
  }

  function evaluateWhenIdle(): void {
    pending = undefined
    const current = generation
    const idle = (doc.defaultView as IdleWindow | null)?.requestIdleCallback
    const task = () => {
      if (current === generation && !decided) evaluate()
    }
    if (idle) idle.call(doc.defaultView, task, { timeout: IDLE_TIMEOUT_MS })
    else task()
  }

  // a pending run is never pushed back, so a page that mutates constantly still gets checked every throttleMs
  function schedule(): void {
    if (pending === undefined) pending = setTimeout(evaluateWhenIdle, throttleMs)
  }

  function observe(ms: number): void {
    const Observer = doc.defaultView?.MutationObserver
    if (!Observer) return
    disconnect()
    observer = new Observer(schedule)
    // observing the document node, not documentElement, survives a page replacing <html>
    observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES })
    budget = setTimeout(disconnect, ms)
    rechecks = recheckMs.filter((delay) => delay < ms).map((delay) => setTimeout(schedule, delay))
  }

  function onVisible(): void {
    if (doc.visibilityState === "visible") api.rearm()
  }

  const api: FormWatcher = {
    start() {
      generation++
      decided = false
      disconnect()
      doc.addEventListener("visibilitychange", onVisible)
      evaluate()
      if (!decided) observe(budgetMs)
    },
    rearm() {
      if (decided || observer) return
      observe(rearmMs)
      schedule()
    },
    stop() {
      generation++
      decided = true
      disconnect()
      doc.removeEventListener("visibilitychange", onVisible)
    },
  }
  return api
}
