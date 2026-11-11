import { TOAST_CSS } from "./styles"

export type ToastAction = "settings" | "retry"
/** What the toast says after the person said yes: working on it, or how it went. */
export type ToastMessage = { text: string; actions?: readonly ToastAction[]; busy?: boolean }
export type ToastView = { show: () => void; showMessage: (message: ToastMessage) => void; hide: () => void }

type ToastHandlers = {
  onYes: () => void
  onNo: () => void
  onNever: () => void
  onTimeout: () => void
  onSettings?: () => void
  onRetry?: () => void
}

const ASK_TITLE = "Autofill this application?"
const MESSAGE_DISMISS_MS = 12_000
const ACTION_LABEL: Record<ToastAction, string> = { settings: "Open settings", retry: "Retry" }

const AUTO_DISMISS_MS = 20_000
const MAX_REMOUNTS = 20
const HOST_STYLE: Record<string, string> = {
  all: "initial",
  position: "fixed",
  right: "16px",
  bottom: "16px",
  "z-index": "2147483647",
  contain: "layout style",
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

export function createToastView(doc: Document, handlers: ToastHandlers): ToastView {
  let host: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let previousFocus: Element | null = null
  let remounts = 0
  let observer: MutationObserver | null = null
  let watchedRoot: Element | null = null

  let currentTitle = ASK_TITLE
  let dismissMs = AUTO_DISMISS_MS
  let onDismiss: () => void = handlers.onTimeout
  let titleEl: HTMLElement | null = null
  let toastEl: HTMLElement | null = null
  // set when the last action came from the keyboard: the focus it had is gone with the question, so the answer takes it
  let fromKeyboard = false
  let rowEl: HTMLElement | null = null
  let primary: (() => void) | null = handlers.onYes
  let onEscape: () => void = handlers.onNo

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
    toast.setAttribute("aria-label", "Skiffr autofill")
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
      close: () => view.hide(),
      settings: () => handlers.onSettings?.(),
      retry: () => handlers.onRetry?.(),
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
    const frame =
      doc.defaultView?.requestAnimationFrame.bind(doc.defaultView) ?? ((fn: () => void) => setTimeout(fn, 0))
    frame(() => {
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

  const view: ToastView = {
    show() {
      if (host) {
        ensureMounted()
        return
      }
      mount()
      arm()
    },
    showMessage({ text, actions = [], busy = false }) {
      dismissMs = busy ? 0 : MESSAGE_DISMISS_MS
      onDismiss = () => view.hide()
      primary = null
      onEscape = () => view.hide()
      currentTitle = text
      const fresh = !host
      if (fresh) mount()
      else ensureMounted()
      if (!titleEl || !rowEl) return
      // a new toast fills its title on the next frame, so the live region announces it; an open one changes in place
      if (!fresh) titleEl.textContent = text
      titleEl.style.marginBottom = busy || actions.length === 0 ? "0" : ""
      const buttons = actions.map((action, i) => button(doc, ACTION_LABEL[action], action, i === 0 ? "primary" : ""))
      if (!busy) buttons.push(button(doc, "Close", "close", "link"))
      rowEl.replaceChildren(...buttons)
      if (fromKeyboard) toastEl?.focus({ preventScroll: true })
      fromKeyboard = false
      arm()
    },
    hide() {
      clearTimeout(timer)
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
