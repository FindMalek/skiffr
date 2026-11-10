import { TOAST_CSS } from "./styles"

export type ToastView = { show: () => void; hide: () => void }

type ToastHandlers = { onYes: () => void; onNo: () => void; onNever: () => void; onTimeout: () => void }

const AUTO_DISMISS_MS = 20_000
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

export function createToastView(doc: Document, handlers: ToastHandlers): ToastView {
  let host: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let previousFocus: Element | null = null

  function arm(): void {
    clearTimeout(timer)
    timer = setTimeout(handlers.onTimeout, AUTO_DISMISS_MS)
  }

  function build(): HTMLElement {
    const el = doc.createElement("skiffr-toast")
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
      const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action
      if (action) actions[action]?.()
    })
    toast.addEventListener("keydown", (event) => {
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
    requestAnimationFrame(() => {
      title.textContent = "Autofill this application?"
      toast.classList.add("in")
    })
    return el
  }

  return {
    show() {
      if (host?.isConnected) return
      host = build()
      doc.documentElement.append(host)
      arm()
    },
    hide() {
      clearTimeout(timer)
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
