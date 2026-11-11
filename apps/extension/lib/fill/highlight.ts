import { labelsFor, newCtx } from "./collect"
import { isRendered } from "./dom"
import type { CollectedField } from "./types"

// A dark ring next to an amber one: one of the two stands out (3:1 or more) on a light page and the other on a dark one.
const OUTLINE = "2px solid #78350f"
const RING = "0 0 0 4px #fbbf24"
const PROPS = [
  ["outline", OUTLINE],
  ["outline-offset", "0"],
  ["box-shadow", RING],
] as const

/** Inline and `important`, which beats any stylesheet rule the page has, `!important` ones included. */
function outline(el: HTMLElement, note: string): () => void {
  const before = PROPS.map(
    ([name]) => [name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)] as const,
  )
  const describedBefore = el.getAttribute("aria-description")
  for (const [name, value] of PROPS) el.style.setProperty(name, value, "important")
  el.setAttribute("aria-description", note)
  return () => {
    for (const [name, value, priority] of before) el.style.setProperty(name, value, priority)
    if (describedBefore === null) el.removeAttribute("aria-description")
    else el.setAttribute("aria-description", describedBefore)
  }
}

/** Outlines a field for review, with a text for assistive technology that goes with it. Hidden native controls get their label outlined instead. */
export function highlightField(field: CollectedField, note = "Filled by Skiffr, please check"): () => void {
  const grouped = field.choices.length > 0 && field.kind !== "select" && field.kind !== "combobox"
  const members = grouped ? field.choices : [{ el: field.el }]
  const undo = members.map(({ el }) => {
    const target = isRendered(el) ? el : (labelsFor(el, newCtx())[0] ?? el.parentElement ?? el)
    return outline(target, note)
  })
  return () => {
    for (const release of undo) release()
  }
}
