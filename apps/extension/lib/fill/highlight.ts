import { labelsFor } from "./collect"
import { isRendered, view } from "./dom"
import type { CollectedField } from "./types"

const ATTR = "data-skiffr-review"
const CSS = `[${ATTR}]{outline:2px dashed #f59e0b !important;outline-offset:2px !important}`

type Sheets = { adoptedStyleSheets?: CSSStyleSheet[] }
const shared = new WeakMap<Node, { sheet: CSSStyleSheet; count: number }>()

function outline(el: HTMLElement): () => void {
  const root = el.getRootNode() as Node & Sheets
  const win = view(el)
  el.setAttribute(ATTR, "")
  let release = () => el.removeAttribute(ATTR)
  if (typeof win.CSSStyleSheet === "function" && Array.isArray(root.adoptedStyleSheets)) {
    let entry = shared.get(root)
    if (!entry) {
      const sheet = new win.CSSStyleSheet()
      sheet.replaceSync(CSS)
      entry = { sheet, count: 0 }
      shared.set(root, entry)
      root.adoptedStyleSheets = [...(root.adoptedStyleSheets ?? []), sheet]
    }
    entry.count++
    const held = entry
    release = () => {
      el.removeAttribute(ATTR)
      if (--held.count > 0) return
      root.adoptedStyleSheets = (root.adoptedStyleSheets ?? []).filter((sheet) => sheet !== held.sheet)
      shared.delete(root)
    }
  } else {
    const before = [el.style.getPropertyValue("outline"), el.style.getPropertyPriority("outline")] as const
    el.style.setProperty("outline", "2px dashed #f59e0b", "important")
    release = () => {
      el.removeAttribute(ATTR)
      el.style.setProperty("outline", before[0], before[1])
    }
  }
  return release
}

/** Outlines a field for review. Hidden native controls get their label outlined instead. */
export function highlightField(field: CollectedField): () => void {
  const releases =
    field.choices.length > 0 && field.kind !== "select" && field.kind !== "combobox"
      ? field.choices
      : [{ el: field.el }]
  const undo = releases.map(({ el }) => {
    const target = isRendered(el) ? el : (labelsFor(el, { labels: new Map() })[0] ?? el.parentElement ?? el)
    return outline(target)
  })
  return () => {
    for (const release of undo) release()
  }
}
