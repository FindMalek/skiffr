import { collectFields, labelsFor, newCtx } from "./collect"
import { readField } from "./read"
import { isFilling } from "./state"
import type { EditReport, FillSummary } from "./types"

const GESTURES = ["keydown", "pointerdown", "paste", "drop", "beforeinput"] as const
const CHANGES = ["input", "change", "focusout"] as const

/**
 * Reports when a person changes a field that was filled, so the final value can be diffed against the fill.
 * A change only counts after a trusted keydown, pointerdown, paste, drop or beforeinput on that field (or its label):
 * trusted focus, blur and click events can also come from page script. Nothing is reported while the engine is filling.
 */
export function watchEdits(root: ParentNode, summary: FillSummary, onChange: (report: EditReport) => void): () => void {
  const filled = new Map(
    summary.fields.filter((f) => f.status === "filled" && f.value !== undefined).map((f) => [f.id, f.value as string]),
  )
  const ctx = newCtx()
  const undo: (() => void)[] = []
  for (const field of collectFields(root)) {
    const filledValue = filled.get(field.id)
    if (filledValue === undefined) continue
    let last = filledValue
    let gesture = false
    const targets = field.kind === "radio" || field.kind === "checkbox" ? field.choices.map((c) => c.el) : [field.el]
    const sources = [...targets, ...targets.flatMap((target) => labelsFor(target, ctx))]

    const onGesture = (event: Event) => {
      if (event.isTrusted && !isFilling()) gesture = true
    }
    const onEdit = (event: Event) => {
      if (!event.isTrusted) return
      if (isFilling()) {
        last = readField(field)
        return
      }
      if (!gesture) return
      if (event.type !== "input") gesture = false
      const finalValue = readField(field)
      if (finalValue === last) return
      last = finalValue
      onChange({ fieldId: field.id, filledValue, finalValue })
    }
    for (const source of sources) for (const type of GESTURES) source.addEventListener(type, onGesture, true)
    for (const target of targets) for (const type of CHANGES) target.addEventListener(type, onEdit)
    undo.push(() => {
      for (const source of sources) for (const type of GESTURES) source.removeEventListener(type, onGesture, true)
      for (const target of targets) for (const type of CHANGES) target.removeEventListener(type, onEdit)
    })
  }
  return () => {
    for (const remove of undo) remove()
  }
}
