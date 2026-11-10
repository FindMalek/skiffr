import { collectFields } from "./collect"
import { readField } from "./read"
import type { EditReport, FillSummary } from "./types"

const EVENTS = ["input", "change", "focusout"] as const

/** Reports when a person changes a field that was filled, so the final value can be diffed against the fill. Trusted events only. */
export function watchEdits(root: ParentNode, summary: FillSummary, onChange: (report: EditReport) => void): () => void {
  const filled = new Map(
    summary.fields.filter((f) => f.status === "filled" && f.value !== undefined).map((f) => [f.id, f.value as string]),
  )
  const undo: (() => void)[] = []
  for (const field of collectFields(root)) {
    const filledValue = filled.get(field.id)
    if (filledValue === undefined) continue
    let last = filledValue
    const handler = (event: Event) => {
      if (!event.isTrusted) return
      const finalValue = readField(field)
      if (finalValue === last) return
      last = finalValue
      onChange({ fieldId: field.id, filledValue, finalValue })
    }
    const targets =
      field.kind === "radio" || field.kind === "checkbox" ? field.choices.map((choice) => choice.el) : [field.el]
    for (const target of targets) {
      for (const type of EVENTS) target.addEventListener(type, handler)
      undo.push(() => {
        for (const type of EVENTS) target.removeEventListener(type, handler)
      })
    }
  }
  return () => {
    for (const remove of undo) remove()
  }
}
