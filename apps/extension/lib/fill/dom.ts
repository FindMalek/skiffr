export const view = (node: Node): Window & typeof globalThis =>
  (node.ownerDocument ?? (node as Document)).defaultView as Window & typeof globalThis

export const isElement = (node: Node | null | undefined): node is HTMLElement => node?.nodeType === 1

/** Parent that also climbs out of an open shadow root. */
export function parentOf(el: Element): HTMLElement | null {
  if (el.parentElement) return el.parentElement
  const root = el.getRootNode()
  return root.nodeType === 11 ? ((root as ShadowRoot).host as HTMLElement) : null
}

export function frameDocument(el: Element): Document | null {
  try {
    return (el as HTMLIFrameElement).contentDocument
  } catch {
    return null
  }
}

/** Every element below `root` in document order, through open shadow roots and same-origin iframes. */
export function* walkElements(root: ParentNode): Generator<HTMLElement> {
  if (isElement(root as Node)) yield root as HTMLElement
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    yield el
    if (el.shadowRoot) yield* walkElements(el.shadowRoot)
    if (el.localName === "iframe" || el.localName === "frame") {
      const doc = frameDocument(el)
      if (!doc) continue
      if (doc.designMode === "on" && doc.body) yield doc.body
      yield* walkElements(doc)
    }
  }
}

export function isRendered(el: HTMLElement): boolean {
  const win = view(el)
  for (let node: HTMLElement | null = el; node; node = parentOf(node)) {
    const style = win.getComputedStyle(node)
    if (style.display === "none") return false
    if (node === el && (style.visibility === "hidden" || style.visibility === "collapse")) return false
  }
  return true
}

export function isAriaHidden(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = parentOf(node)) {
    if (node.getAttribute("aria-hidden") === "true") return true
  }
  return false
}

export function hasLayout(el: HTMLElement): boolean {
  const html = el.ownerDocument.documentElement
  return html.getBoundingClientRect().width > 0 || html.clientWidth > 0
}

export function isDisabled(el: HTMLElement): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true
  try {
    if (el.matches(":disabled")) return true
  } catch {}
  return (el as HTMLInputElement).disabled === true || el.closest("fieldset[disabled]") !== null
}

export function cleanText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[\s ​]+/g, " ")
    .replace(/^\s*\*+\s*/, "")
    .replace(/\s*(\*+|\(\s*required\s*\)|\brequired\b)\s*$/i, "")
    .trim()
}

const CONTROLS = "input,select,textarea,button,script,style,option,[role=listbox],[role=combobox],[aria-hidden=true]"

/** Visible text of a node, without the form controls and decoration inside it. */
export function textOf(node: Node): string {
  if (node.nodeType === 3) return cleanText(node.textContent)
  if (!isElement(node)) return ""
  const clone = node.cloneNode(true) as HTMLElement
  for (const inner of Array.from(clone.querySelectorAll(CONTROLS))) inner.remove()
  return cleanText(clone.textContent)
}

export function containsControl(el: Element): boolean {
  return (
    el.matches("input,select,textarea,[contenteditable],[role=combobox]") ||
    el.querySelector("input,select,textarea") !== null
  )
}

type Init = Record<string, unknown>

function make(el: Element, name: string, init: Init, ctor?: string): Event {
  type EventCtor = new (type: string, init?: Init) => Event
  const win = view(el) as unknown as Record<string, EventCtor>
  const Ctor = ((ctor && win[ctor]) || win.Event) as EventCtor
  return new Ctor(name, { bubbles: true, composed: true, cancelable: true, view: view(el), ...init })
}

export function fire(el: Element, name: string, init: Init = {}, ctor?: string): void {
  el.dispatchEvent(make(el, name, init, ctor))
}

export const fireInput = (el: Element, data: string | null, inputType = "insertText") =>
  fire(el, "input", { cancelable: false, inputType, data }, "InputEvent")

export const fireChange = (el: Element) => fire(el, "change", { cancelable: false })

export function fireKey(el: Element, type: "keydown" | "keyup", key: string): void {
  fire(el, type, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key }, "KeyboardEvent")
}

export function click(el: HTMLElement): void {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    fire(
      el,
      type,
      { button: 0, buttons: type.endsWith("down") ? 1 : 0 },
      type.startsWith("pointer") ? "PointerEvent" : "MouseEvent",
    )
  }
  el.click()
}

export function focusEl(el: HTMLElement): void {
  let seen = false
  const mark = () => {
    seen = true
  }
  el.addEventListener("focus", mark, { once: true })
  el.focus()
  el.removeEventListener("focus", mark)
  if (!seen) {
    fire(el, "focus", { bubbles: false, cancelable: false }, "FocusEvent")
    fire(el, "focusin", { cancelable: false }, "FocusEvent")
  }
}

export function blurEl(el: HTMLElement): void {
  let seen = false
  const mark = () => {
    seen = true
  }
  el.addEventListener("blur", mark, { once: true })
  el.blur()
  el.removeEventListener("blur", mark)
  if (!seen) {
    fire(el, "blur", { bubbles: false, cancelable: false }, "FocusEvent")
    fire(el, "focusout", { cancelable: false }, "FocusEvent")
  }
}

export const settle = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function waitFor(check: () => boolean, timeoutMs: number, stepMs = 25): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (true) {
    if (check()) return true
    if (Date.now() >= end) return false
    await settle(stepMs)
  }
}

/** Writes through the prototype setter so React's value tracker on the instance sees a real change. */
export function setNativeValue(el: HTMLElement, value: string): void {
  const win = view(el)
  const proto =
    el.localName === "textarea"
      ? win.HTMLTextAreaElement.prototype
      : el.localName === "select"
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
  if (setter) setter.call(el, value)
  else (el as HTMLInputElement).value = value
}
