import { type Detection, detectApplicationForm } from "./score"

export type FormWatcher = { start: () => void; rearm: () => void; stop: () => void }

type WatchOptions = {
  doc: Document
  onDetect: (detection: Detection) => void
  check?: (doc: Document) => Detection
  debounceMs?: number
  budgetMs?: number
  rearmMs?: number
}

const DEFAULTS = { debounceMs: 400, budgetMs: 15_000, rearmMs: 3_000 }

export function createFormWatcher(options: WatchOptions): FormWatcher {
  const { doc, onDetect, check = (target) => detectApplicationForm(target) } = options
  const { debounceMs, budgetMs, rearmMs } = { ...DEFAULTS, ...options }
  let observer: MutationObserver | null = null
  let debounce: ReturnType<typeof setTimeout> | undefined
  let budget: ReturnType<typeof setTimeout> | undefined
  let decided = false

  function disconnect(): void {
    observer?.disconnect()
    observer = null
    clearTimeout(debounce)
    clearTimeout(budget)
  }

  function run(): void {
    const detection = check(doc)
    if (!detection.isForm) return
    decided = true
    disconnect()
    onDetect(detection)
  }

  function observe(ms: number): void {
    const Observer = doc.defaultView?.MutationObserver
    if (!Observer || !doc.documentElement) return
    disconnect()
    observer = new Observer(() => {
      clearTimeout(debounce)
      debounce = setTimeout(run, debounceMs)
    })
    observer.observe(doc.documentElement, { childList: true, subtree: true })
    budget = setTimeout(disconnect, ms)
  }

  return {
    start() {
      decided = false
      disconnect()
      run()
      if (!decided) observe(budgetMs)
    },
    rearm() {
      if (!decided && !observer) observe(rearmMs)
    },
    stop() {
      decided = true
      disconnect()
    },
  }
}
