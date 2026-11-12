import { type CollectedField, collectFields, readField } from "./fill"
import { toFillField } from "./fill-client"

const SEARCHY = /\bsearch(box)?\b/i
const MASKED = /disc|circle|square/

export type LiveField = {
  /** The field with its options as the lookup asked about them. The control is the one on the page now, if there is one. */
  field: CollectedField
  /** What the control shows now. */
  value: string
  /** The page swapped the control for another one after the fill, so nothing watched it. */
  replaced: boolean
  /** The control left the page (the next step of a form): all that is known is what the fill and the person's edits left. */
  gone: boolean
  /** The field stays in the batch so the form still matches the lookup, but it holds no values. */
  blank: boolean
}

function masked(el: HTMLElement): boolean {
  try {
    return MASKED.test(
      el.ownerDocument.defaultView?.getComputedStyle(el).getPropertyValue("-webkit-text-security") ?? "",
    )
  } catch {
    return false
  }
}

/**
 * The fields of a session as they are on the page right now. A field is read only if it is still there (the same
 * control, or the control the page swapped in for it) with the label, type and autocomplete it had at the fill: a
 * relabelled or retyped input may be a different question by now. Search boxes and text-masked inputs are never read.
 * Those fields stay as blank entries, because the lookup asked about them and the server matches the form by its fields.
 */
export function liveFields(roots: ParentNode[], snapshot: CollectedField[]): LiveField[] {
  const live = roots.flatMap((root) => collectFields(root))
  const byEl = new Map(live.map((field) => [field.el, field]))
  const byId = new Map(live.map((field) => [field.id, field]))
  return snapshot.map((field) => {
    const before = toFillField(field)
    const searchy = SEARCHY.test(`${before.label} ${before.name ?? ""} ${before.placeholder ?? ""}`)
    const same = field.el.isConnected ? byEl.get(field.el) : undefined
    const now = same ?? byId.get(field.id)
    if (!now) {
      const gone = !field.el.isConnected
      return { field, value: "", replaced: false, gone, blank: searchy || !gone }
    }
    const after = toFillField(now)
    const changed =
      after.label !== before.label || after.type !== before.type || after.autocomplete !== before.autocomplete
    return {
      field: changed
        ? field
        : { ...now, id: field.id, descriptor: { ...now.descriptor, options: field.descriptor.options } },
      value: readField(now),
      replaced: !same,
      gone: false,
      blank: changed || searchy || masked(now.el),
    }
  })
}
