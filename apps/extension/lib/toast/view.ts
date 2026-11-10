import { TOAST_CSS } from "./styles"

export type ToastView = { show: () => void; hide: () => void }

type ToastHandlers = { onYes: () => void; onNo: () => void; onNever: () => void; onTimeout: () => void }

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

  function arm(): void {
    clearTimeout(timer)
    timer = setTimeout(handlers.onTimeout, AUTO_DISMISS_MS)
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
    row.append(
      button(doc, "Yes", "yes", "primary"),
      button(doc, "No", "no"),
      button(doc, "Don't ask on this site", "never", "link"),
    )

    const actions: Record<string, () => void> = { yes: handlers.onYes, no: handlers.onNo, never: handlers.onNever }
    toast.addEventListener("click", (event) => {
      if (!event.isTrusted) return
      const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action
      if (action) actions[action]?.()
    })
    toast.addEventListener("keydown", (event) => {
      if (!event.isTrusted) return
      if (event.key === "Escape") handlers.onNo()
      else if (event.key === "Enter" && event.target === toast) handlers.onYes()
      else return
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
      title.textContent = "Autofill this application?"
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

  return {
    show() {
      if (host) {
        ensureMounted()
        return
      }
      const root = doc.documentElement
      if (!root) return
      host = build()
      remounts = 0
      root.append(host)
      watch(root)
      arm()
    },
    hide() {
      clearTimeout(timer)
      unwatch()
      const hadFocus = host !== null && doc.activeElement === host
      host?.remove()
      host = null
      if (hadFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
      previousFocus = null
    },
  }
}
