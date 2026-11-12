import { type CollectedField, collectFields, readField } from "./fill"
import { toFillField } from "./fill-client"

const SEARCHY = /\bsearch(box)?\b/i
const MASKED = /disc|circle|square/

export type LiveField = {
  /** The field as the learning session first saw it, with its options (what the lookup asked about). */
  field: CollectedField
  /** What the control shows now. */
  value: string
  /** The page swapped the control for another one after the fill, so nothing watched it. */
  replaced: boolean
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
 * The fields of a session as they are on the page right now. A field is kept only if it is still there (the same
 * control, or the control the page swapped in for it) with the label, type and autocomplete it had at the fill: a
 * relabelled or retyped input may be a different question by now. Search boxes and text-masked inputs never count.
 */
export function liveFields(roots: ParentNode[], snapshot: CollectedField[]): LiveField[] {
  const live = roots.flatMap((root) => collectFields(root))
  const byEl = new Map(live.map((field) => [field.el, field]))
  const byId = new Map(live.map((field) => [field.id, field]))
  const kept: LiveField[] = []
  for (const field of snapshot) {
    const same = field.el.isConnected ? byEl.get(field.el) : undefined
    const now = same ?? byId.get(field.id)
    if (!now || masked(now.el)) continue
    const before = toFillField(field)
    const after = toFillField(now)
    if (after.label !== before.label || after.type !== before.type || after.autocomplete !== before.autocomplete)
      continue
    if (SEARCHY.test(`${after.label} ${after.name ?? ""} ${after.placeholder ?? ""}`)) continue
    kept.push({
      field: { ...now, id: field.id, descriptor: { ...now.descriptor, options: field.descriptor.options } },
      value: readField(now),
      replaced: !same,
    })
  }
  return kept
}
