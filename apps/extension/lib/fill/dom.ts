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

const MAX_FRAME_DEPTH = 3
const MAX_FRAMES = 20
const MAX_ELEMENTS = 100_000

type WalkBudget = { frames: number; elements: number }

/** Every element below `root` in document order, through open shadow roots and same-origin iframes, within a depth and size budget. */
export function* walkElements(
  root: ParentNode,
  depth = 0,
  budget: WalkBudget = { frames: 0, elements: 0 },
): Generator<HTMLElement> {
  if (isElement(root as Node)) yield root as HTMLElement
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (++budget.elements > MAX_ELEMENTS) return
    yield el
    if (el.shadowRoot) yield* walkElements(el.shadowRoot, depth, budget)
    if (el.localName === "iframe" || el.localName === "frame") {
      if (depth >= MAX_FRAME_DEPTH || budget.frames >= MAX_FRAMES) continue
      const doc = frameDocument(el)
      if (!doc) continue
      budget.frames++
      if (doc.designMode === "on" && doc.body) yield doc.body
      yield* walkElements(doc, depth + 1, budget)
    }
  }
}

type VisibilityCheck = { checkVisibility?: (options?: Record<string, boolean>) => boolean }

/** Display, visibility and content-visibility only. Opacity, clipping and overlays are `isVisible` in visibility.ts. */
export function isRendered(el: HTMLElement): boolean {
  const native = (el as VisibilityCheck).checkVisibility
  if (typeof native === "function") return native.call(el, { visibilityProperty: true, contentVisibilityAuto: true })
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

const MARKERS = "*\u2731\u2217\u2733\uff0a\u204e"
const STAR_MARKERS = /[\u2731\u2217\u2733\uff0a\u204e]/g
const EDGE_MARKERS = new RegExp(`^[\\s${MARKERS}]+|[\\s${MARKERS}]+$`, "g")

export function cleanText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(STAR_MARKERS, "")
    .replace(/[\s\u00a0\u200b]+/g, " ")
    .replace(EDGE_MARKERS, "")
    .replace(/\s*(\(\s*required\s*\)|\brequired\b)\s*$/i, "")
    .trim()
}

const CONTROLS = "input,select,textarea,button,script,style,option,[role=listbox],[role=combobox],[aria-hidden=true]"

function gatherText(node: Node, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) out.push(child.textContent ?? "")
    else if (isElement(child) && !child.matches(CONTROLS)) gatherText(child, out)
  }
}

/** Visible text of a node, without the form controls and decoration inside it. Text nodes are joined with a space. */
export function textOf(node: Node): string {
  if (node.nodeType === 3) return cleanText(node.textContent)
  if (!isElement(node) || node.matches(CONTROLS)) return ""
  const out: string[] = []
  gatherText(node, out)
  return cleanText(out.join(" "))
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
