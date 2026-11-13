import type { Field } from "../fields.ts"
import { esc } from "../html.ts"

export interface ControlOptions {
  id: string
  name: string
  cls?: string
  attrs?: string
}

/** The bare control of a field. Each board wraps it in its own label and class names. */
export function control(field: Field, { id, name, cls = "", attrs = "" }: ControlOptions): string {
  const common = `id="${esc(id)}" name="${esc(name)}"${cls ? ` class="${esc(cls)}"` : ""}${field.required ? " required" : ""}${attrs ? ` ${attrs}` : ""}`
  const auto = field.autocomplete ? ` autocomplete="${esc(field.autocomplete)}"` : ""
  switch (field.kind) {
    case "textarea":
      return `<textarea ${common} rows="5"></textarea>`
    case "select": {
      const options = (field.options ?? [])
        .map((option) => `<option value="${esc(option)}">${esc(option)}</option>`)
        .join("")
      return `<select ${common}><option value="">Select...</option>${options}</select>`
    }
    case "radio": {
      const options = (field.options ?? [])
        .map(
          (option, index) =>
            `<label class="radio"><input type="radio" id="${esc(id)}-${index}" name="${esc(name)}" value="${esc(option)}"${cls ? ` class="${esc(cls)}"` : ""}> ${esc(option)}</label>`,
        )
        .join("")
      return `<div role="radiogroup" aria-labelledby="${esc(id)}-label">${options}</div>`
    }
    case "checkbox":
      return `<input type="checkbox" ${common} value="yes">`
    case "file":
      return `<input type="file" ${common}>`
    default:
      return `<input type="${field.kind}" ${common}${auto}>`
  }
}

export const star = (field: Field): string => (field.required ? ' <span class="req" aria-hidden="true">*</span>' : "")
