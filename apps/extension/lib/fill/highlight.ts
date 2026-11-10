import { labelsFor, newCtx } from "./collect"
import { isRendered } from "./dom"
import type { CollectedField } from "./types"

const OUTLINE = "2px dashed #f59e0b"

/** Inline and `important`, which beats any stylesheet rule the page has, `!important` ones included. */
function outline(el: HTMLElement): () => void {
  const before = [el.style.getPropertyValue("outline"), el.style.getPropertyPriority("outline")] as const
  const offset = [el.style.getPropertyValue("outline-offset"), el.style.getPropertyPriority("outline-offset")] as const
  el.style.setProperty("outline", OUTLINE, "important")
  el.style.setProperty("outline-offset", "2px", "important")
  return () => {
    el.style.setProperty("outline", before[0], before[1])
    el.style.setProperty("outline-offset", offset[0], offset[1])
  }
}

/** Outlines a field for review. Hidden native controls get their label outlined instead. */
export function highlightField(field: CollectedField): () => void {
  const grouped = field.choices.length > 0 && field.kind !== "select" && field.kind !== "combobox"
  const members = grouped ? field.choices : [{ el: field.el }]
  const undo = members.map(({ el }) => {
    const target = isRendered(el) ? el : (labelsFor(el, newCtx())[0] ?? el.parentElement ?? el)
    return outline(target)
  })
  return () => {
    for (const release of undo) release()
  }
}
