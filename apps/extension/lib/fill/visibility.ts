import { hasLayout, isRendered, parentOf, view } from "./dom"

type NodeInfo = { hides: boolean; clips: boolean }

export type VisibilityCtx = {
  info: Map<HTMLElement, NodeInfo>
  chain: Map<HTMLElement, boolean>
  /** Whether a hit that is in front of a field is a cookie dialog or its backdrop. */
  consent: Map<Element, boolean>
}

export const newVisibilityCtx = (): VisibilityCtx => ({ info: new Map(), chain: new Map(), consent: new Map() })

type Native = { checkVisibility?: (options?: Record<string, boolean>) => boolean }

const px = (value: string) => (value.endsWith("px") ? Number.parseFloat(value) : Number.NaN)
const SAMPLES = [
  [0.5, 0.5],
  [0.2, 0.3],
  [0.8, 0.3],
  [0.2, 0.7],
  [0.8, 0.7],
] as const

function frameOf(el: HTMLElement): HTMLElement | null {
  try {
    return (el.ownerDocument.defaultView?.frameElement as HTMLElement | null) ?? null
  } catch {
    return null
  }
}

const isClipping = (style: CSSStyleDeclaration) =>
  (style.overflowX !== "visible" && style.overflowX !== "") || (style.overflowY !== "visible" && style.overflowY !== "")

function clipsToNothing(style: CSSStyleDeclaration, rect: DOMRect, layout: boolean): boolean {
  const clip = /^rect\(([^)]*)\)$/.exec(style.clip)
  if (clip && style.position !== "static") {
    const [top, right, bottom, left] = (clip[1] ?? "").split(/[\s,]+/).map(px)
    if ((right ?? 0) - (left ?? 0) < 2 || (bottom ?? 0) - (top ?? 0) < 2) return true
  }
  if (/inset\(\s*(50|[6-9]\d|100)%/.test(style.clipPath)) return true
  if (isClipping(style)) {
    if (style.display === "contents" || style.display === "inline") return false
    const [w, h] = layout ? [rect.width, rect.height] : [px(style.width), px(style.height)]
    if (w < 2 || h < 2 || px(style.maxHeight) === 0) return true
  }
  return false
}

function infoOf(node: HTMLElement, ctx: VisibilityCtx, layout: boolean): NodeInfo {
  let known = ctx.info.get(node)
  if (!known) {
    const style = view(node).getComputedStyle(node)
    known = {
      hides:
        style.display === "none" ||
        style.opacity === "0" ||
        style.contentVisibility === "hidden" ||
        /opacity\(\s*0(\.0+)?\s*\)/.test(style.filter) ||
        clipsToNothing(style, node.getBoundingClientRect(), layout),
      clips: isClipping(style) && style.display !== "contents" && style.display !== "inline",
    }
    ctx.info.set(node, known)
  }
  return known
}

/** True when the node or something above it removes it from view in a way `checkVisibility` does not see. Memoized per node. */
function ancestorHides(node: HTMLElement | null, ctx: VisibilityCtx, layout: boolean): boolean {
  if (!node || node.localName === "html" || node.localName === "body") return false
  const known = ctx.chain.get(node)
  if (known !== undefined) return known
  const hides = infoOf(node, ctx, layout).hides || ancestorHides(parentOf(node), ctx, layout)
  ctx.chain.set(node, hides)
  return hides
}

/** The part of the element's box that is inside the viewport and inside every clipping ancestor: where a person could point. */
function reachable(el: HTMLElement, rect: DOMRect, ctx: VisibilityCtx, layout: boolean): DOMRect | null {
  const win = view(el)
  let left = Math.max(rect.left, 0)
  let top = Math.max(rect.top, 0)
  let right = Math.min(rect.right, win.innerWidth)
  let bottom = Math.min(rect.bottom, win.innerHeight)
  for (let node = parentOf(el); node && node.localName !== "html"; node = parentOf(node)) {
    if (node.localName === "body" || !infoOf(node, ctx, layout).clips) continue
    const box = node.getBoundingClientRect()
    left = Math.max(left, box.left)
    top = Math.max(top, box.top)
    right = Math.min(right, box.right)
    bottom = Math.min(bottom, box.bottom)
  }
  return right - left >= 1 && bottom - top >= 1 ? new win.DOMRect(left, top, right - left, bottom - top) : null
}

const DIALOG = "[role=dialog],[role=alertdialog],dialog"
const CONSENT_WORDS = /cookie|consent|gdpr|onetrust|cookiebot|trustarc|didomi|usercentrics|quantcast/i
const ANSWERS = "button,[role=button],input[type=button],input[type=submit]"
const DIMS_MIN = 0.9
const DRAWN_MIN = 0.5

function namesConsent(dialog: Element): boolean {
  const names = ["id", "class", "aria-label", "data-ui", "data-testid"].map((name) => dialog.getAttribute(name) ?? "")
  return CONSENT_WORDS.test(names.join(" "))
}

/** How much of the page shows through the element and its ancestors. */
function opacityOf(el: HTMLElement): number {
  let seen = 1
  for (let node: HTMLElement | null = el; node && seen >= DRAWN_MIN; node = parentOf(node)) {
    seen *= Number.parseFloat(view(node).getComputedStyle(node).opacity || "1")
  }
  return seen
}

const isFixed = (el: Element) => view(el as HTMLElement).getComputedStyle(el).position === "fixed"

/** A drawn, fixed box over nearly the whole viewport that takes the pointer: what dims a page behind a modal. */
function dimsPage(el: Element): boolean {
  const node = el as HTMLElement
  const style = view(node).getComputedStyle(node)
  if (style.position !== "fixed" || style.pointerEvents === "none" || style.visibility === "hidden") return false
  if (style.display === "none" || opacityOf(node) < DRAWN_MIN) return false
  const win = view(node)
  const box = node.getBoundingClientRect()
  return box.width >= win.innerWidth * DIMS_MIN && box.height >= win.innerHeight * DIMS_MIN
}

const empty = (el: Element) => !el.textContent?.trim() && !el.querySelector(`input,textarea,select,a,${ANSWERS}`)

/**
 * A cookie dialog dims the page until it is answered, and Workable's covers the first screen of the form. The fields
 * under it are the ones the person sees once they answer it. The page names its own dialog, so the name is not enough:
 * the dialog is fixed, has a button, and a fixed box over the viewport that is drawn dims the page next to it.
 */
function consentCover(hit: Element): boolean {
  const own = hit.closest(DIALOG)
  if (own) {
    if (!namesConsent(own) || !isFixed(own) || !own.querySelector(ANSWERS)) return false
    return Array.from(own.parentElement?.children ?? []).some((sibling) => sibling !== own && dimsPage(sibling))
  }
  if (!dimsPage(hit) || !empty(hit)) return false
  const dialogs = Array.from(hit.parentElement?.children ?? []).filter((sibling) => sibling.matches(DIALOG))
  return dialogs.some((dialog) => namesConsent(dialog) && isFixed(dialog) && dialog.querySelector(ANSWERS) !== null)
}

function isConsentCover(hit: Element, ctx: VisibilityCtx): boolean {
  let known = ctx.consent.get(hit)
  if (known === undefined) {
    known = consentCover(hit)
    ctx.consent.set(hit, known)
  }
  return known
}

/** What a box in front of the field means for the person: it is the field or its label, a cookie layer to look through, or in the way. */
function verdict(hit: Element, el: HTMLElement, ctx: VisibilityCtx): "field" | "consent" | "blocks" {
  if (hit === el || el.contains(hit)) return "field"
  const label = hit.closest("label")
  if (label && (label.contains(el) || (el.id !== "" && label.getAttribute("for") === el.id))) return "field"
  return isConsentCover(hit, ctx) ? "consent" : "blocks"
}

/** The top box decides, unless it is a cookie layer: then everything under the point is read, so a plain cover below it still counts. */
function reaches(root: Document | ShadowRoot, x: number, y: number, el: HTMLElement, ctx: VisibilityCtx): boolean {
  const top = root.elementFromPoint(x, y)
  if (!top) return false
  const first = verdict(top, el, ctx)
  if (first !== "consent") return first === "field"
  for (const hit of root.elementsFromPoint?.(x, y) ?? []) {
    const seen = verdict(hit, el, ctx)
    if (seen !== "consent") return seen === "field"
  }
  return false
}

function covered(el: HTMLElement, rect: DOMRect, ctx: VisibilityCtx): boolean {
  const win = view(el)
  if (win.getComputedStyle(el).pointerEvents === "none") return false
  const root = el.getRootNode() as Document | ShadowRoot
  if (typeof root.elementFromPoint !== "function") return false
  const seen = reachable(el, rect, ctx, true)
  if (!seen) return false
  for (const [fx, fy] of SAMPLES) {
    if (reaches(root, seen.left + seen.width * fx, seen.top + seen.height * fy, el, ctx)) return false
  }
  return true
}

/**
 * Could a person see and reach this element? Checks the element and everything above it, climbs out of iframes, and
 * hit-tests only elements that are inside the viewport now, so a field below the fold still counts as visible.
 */
export function isVisible(el: HTMLElement, ctx: VisibilityCtx): boolean {
  const native = (el as Native).checkVisibility
  if (typeof native === "function") {
    const ok = native.call(el, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
    if (!ok) return false
  } else if (!isRendered(el)) return false

  const win = view(el)
  const layout = hasLayout(el)
  const style = win.getComputedStyle(el)
  if (
    style.opacity === "0" ||
    /opacity\(\s*0(\.0+)?\s*\)/.test(style.filter) ||
    /inset\(\s*(50|[6-9]\d|100)%/.test(style.clipPath)
  )
    return false
  if (ancestorHides(parentOf(el), ctx, layout)) return false

  if (layout) {
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1 || (rect.width <= 1 && rect.height <= 1)) return false
    if (rect.right + win.scrollX <= 0 || rect.bottom + win.scrollY <= 0) return false
    if (rect.left >= win.innerWidth * 1.5) return false
    if (covered(el, rect, ctx)) return false
  } else {
    if (px(style.width) === 0 || px(style.height) === 0) return false
    if (style.position === "absolute" || style.position === "fixed") {
      if (px(style.left) <= -1000 || px(style.top) <= -1000) return false
    }
  }

  const frame = frameOf(el)
  return frame ? isVisible(frame, ctx) : true
}
