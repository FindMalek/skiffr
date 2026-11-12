import { TOAST_CSS } from "./styles"

export type ToastAction = "settings" | "retry" | "open-next" | "mark-applied" | "not-now" | "stop-next"
/** What the toast says after the person said yes: working on it, or how it went. */
export type ToastMessage = {
  text: string
  actions?: readonly ToastAction[]
  busy?: boolean
  /** Close after this long instead of the usual spell. */
  dismissMs?: number
  /** The person closed it, or it timed out. Not called when another message replaces it or the page hides it. */
  onClose?: () => void
}
export type ToastView = { show: () => void; showMessage: (message: ToastMessage) => void; hide: () => void }

type ToastHandlers = {
  onYes: () => void
  onNo: () => void
  onNever: () => void
  onTimeout: () => void
  onSettings?: () => void
  onRetry?: () => void
  onOpenNext?: () => void
  onMarkApplied?: () => void
  onStopNext?: () => void
}

const ASK_TITLE = "Autofill this application?"
const MESSAGE_DISMISS_MS = 12_000
const ACTION_LABEL: Record<ToastAction, string> = {
  settings: "Open settings",
  retry: "Retry",
  "open-next": "Open next job",
  "mark-applied": "Mark applied",
  "not-now": "Not now",
  "stop-next": "Don't ask on this site",
}
const LINK_ACTIONS: ReadonlySet<ToastAction> = new Set(["stop-next"])

const AUTO_DISMISS_MS = 20_000
const MAX_REMOUNTS = 20
/** The host box never depends on what the toast says: a page can measure its host element, not what is inside the closed root. */
const HOST_STYLE: Record<string, string> = {
  all: "initial",
  position: "fixed",
  right: "16px",
  bottom: "16px",
  display: "flex",
  "flex-direction": "column",
  "justify-content": "flex-end",
  width: "320px",
  "max-width": "calc(100vw - 32px)",
  height: "360px",
  "max-height": "calc(100vh - 32px)",
  // the host is only a frame: clicks outside the toast reach the page
  "pointer-events": "none",
  "z-index": "2147483647",
  contain: "layout style",
  // `all: initial` leaves direction alone, so a right to left page would mirror the toast
  direction: "ltr",
}

function button(doc: Document, label: string, action: string, className = ""): HTMLButtonElement {
  const el = doc.createElement("button")
  el.type = "button"
  el.textContent = label
  el.dataset.action = action
  if (className) el.className = className
  return el
}

// a fresh tag name per page load, so a page cannot select the toast by a fixed name
const HOST_TAG = `x-${Math.random().toString(36).slice(2, 10).padEnd(8, "a")}`

function afterFrameOf(doc: Document): (fn: () => void) => void {
  return (fn) =>
    doc.defaultView?.requestAnimationFrame ? doc.defaultView.requestAnimationFrame(fn) : setTimeout(fn, 0)
}

export function createToastView(doc: Document, handlers: ToastHandlers): ToastView {
  let host: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let previousFocus: Element | null = null
  let remounts = 0
  let observer: MutationObserver | null = null
  let watchedRoot: Element | null = null

  const afterFrame = afterFrameOf(doc)
  let currentTitle = ASK_TITLE
  let dismissMs = AUTO_DISMISS_MS
  let onDismiss: () => void = handlers.onTimeout
  let titleEl: HTMLElement | null = null
  let toastEl: HTMLElement | null = null
  // set when the answer to the question came from the keyboard: the focus it had is gone with the question, so the
  // messages that follow take it, and take it back when filling the page moved it into a field
  let fromKeyboard = false
  let rowEl: HTMLElement | null = null
  let primary: (() => void) | null = handlers.onYes
  let onEscape: () => void = handlers.onNo
  let onClose: (() => void) | undefined

  function arm(): void {
    clearTimeout(timer)
    if (dismissMs > 0) timer = setTimeout(onDismiss, dismissMs)
  }

  function build(): HTMLElement {
    const el = doc.createElement(HOST_TAG)
    for (const [prop, value] of Object.entries(HOST_STYLE)) el.style.setProperty(prop, value, "important")
    const root = el.attachShadow({ mode: "closed" })
    const style = doc.createElement("style")
    style.textContent = TOAST_CSS

    const toast = doc.createElement("div")
    toast.className = "toast"
    toast.setAttribute("role", "dialog")
    toast.setAttribute("aria-label", "skiffr autofill")
    toast.tabIndex = -1

    const title = doc.createElement("p")
    title.className = "title"
    title.setAttribute("role", "status")
    title.setAttribute("aria-live", "polite")

    const row = doc.createElement("div")
    row.className = "row"
    titleEl = title
    toastEl = toast
    rowEl = row
    row.append(
      button(doc, "Yes", "yes", "primary"),
      button(doc, "No", "no"),
      button(doc, "Don't ask on this site", "never", "link"),
    )

    const actions: Record<string, () => void> = {
      yes: handlers.onYes,
      no: handlers.onNo,
      never: handlers.onNever,
      close: () => dismiss(),
      settings: () => handlers.onSettings?.(),
      retry: () => handlers.onRetry?.(),
      "open-next": () => handlers.onOpenNext?.(),
      "mark-applied": () => handlers.onMarkApplied?.(),
      "not-now": () => dismiss(),
      "stop-next": () => handlers.onStopNext?.(),
    }
    toast.addEventListener("click", (event) => {
      if (!event.isTrusted) return
      const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action
      // a click with no pointer (detail 0) is Enter or Space on a focused button
      if (action) fromKeyboard = event.detail === 0
      if (action) actions[action]?.()
    })
    toast.addEventListener("keydown", (event) => {
      if (!event.isTrusted) return
      if (event.key === "Escape") onEscape()
      else if (event.key === "Enter" && event.target === toast && primary) {
        fromKeyboard = true
        primary()
      } else return
      event.preventDefault()
      event.stopPropagation()
    })
    toast.addEventListener("pointerenter", () => clearTimeout(timer))
    toast.addEventListener("pointerleave", arm)
    toast.addEventListener("focusin", () => clearTimeout(timer))
    toast.addEventListener("focusout", arm)
    el.addEventListener("focusin", (event) => {
      previousFocus ??= (event as FocusEvent).relatedTarget as Element | null
    })

    toast.append(title, row)
    root.append(style, toast)
    afterFrame(() => {
      title.textContent = currentTitle
      toast.classList.add("in")
    })
    return el
  }

  // pages such as greenhouse replace <html> after load, which throws the host away with the old tree
  function ensureMounted(): void {
    const root = doc.documentElement
    if (!host || !root) return
    if (host.parentNode !== root) {
      if (remounts >= MAX_REMOUNTS) {
        unwatch()
        return
      }
      remounts++
      root.append(host)
    }
    if (root !== watchedRoot) watch(root)
  }

  function watch(root: Element): void {
    const Observer = doc.defaultView?.MutationObserver
    if (!Observer) return
    observer?.disconnect()
    observer = new Observer(ensureMounted)
    observer.observe(doc, { childList: true })
    observer.observe(root, { childList: true })
    watchedRoot = root
  }

  function unwatch(): void {
    observer?.disconnect()
    observer = null
    watchedRoot = null
  }

  function mount(): void {
    const root = doc.documentElement
    if (!root) return
    host = build()
    remounts = 0
    root.append(host)
    watch(root)
  }

  function dismiss(): void {
    fromKeyboard = false
    const closed = onClose
    view.hide()
    closed?.()
  }

  const view: ToastView = {
    show() {
      fromKeyboard = false
      if (host) {
        ensureMounted()
        return
      }
      mount()
      arm()
    },
    showMessage({ text, actions = [], busy = false, dismissMs: spell = MESSAGE_DISMISS_MS, onClose: closeHook }) {
      dismissMs = busy ? 0 : spell
      onClose = closeHook
      onDismiss = () => dismiss()
      primary = null
      onEscape = () => dismiss()
      currentTitle = text
      const fresh = !host
      if (fresh) mount()
      else ensureMounted()
      if (!titleEl || !rowEl) return
      // a new toast fills its title on the next frame, so the live region announces it; an open one changes in place
      if (!fresh) titleEl.textContent = text
      titleEl.style.marginBottom = busy || actions.length === 0 ? "0" : ""
      const buttons = actions.map((action, i) =>
        button(doc, ACTION_LABEL[action], action, LINK_ACTIONS.has(action) ? "link" : i === 0 ? "primary" : ""),
      )
      if (!busy && !actions.includes("not-now")) buttons.push(button(doc, "Close", "close", "link"))
      rowEl.replaceChildren(...buttons)
      if (fromKeyboard) {
        // a node that was only just attached cannot always take focus before its first frame, so try again then
        toastEl?.focus({ preventScroll: true })
        if (fresh) afterFrame(() => host && doc.activeElement !== host && toastEl?.focus({ preventScroll: true }))
      }
      arm()
    },
    hide() {
      clearTimeout(timer)
      onClose = undefined
      currentTitle = ASK_TITLE
      dismissMs = AUTO_DISMISS_MS
      onDismiss = handlers.onTimeout
      primary = handlers.onYes
      onEscape = handlers.onNo
      unwatch()
      const hadFocus = host !== null && doc.activeElement === host
      host?.remove()
      host = null
      if (
        hadFocus &&
        previousFocus instanceof (doc.defaultView?.HTMLElement ?? HTMLElement) &&
        previousFocus.isConnected
      ) {
        previousFocus.focus({ preventScroll: true })
      }
      previousFocus = null
    },
  }
  return view
}
