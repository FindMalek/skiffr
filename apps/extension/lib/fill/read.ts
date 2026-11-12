import { adapterFor, adapterRead } from "../adapters"
import { isPlaceholderOption } from "./collect"
import { cleanText, textOf } from "./dom"
import type { CollectedField } from "./types"

const VALUE_NODES =
  '[class*="single-value" i],[class*="singleValue" i],[class*="multi-value__label" i],[class*="multiValue" i] [class*="label" i]'
const FIELDS = "input:not([type=hidden]),select,textarea"

/** A combobox input is empty once a choice is made: the choice is drawn next to it, so look in the widget around the input. */
function readCombobox(el: HTMLElement): string {
  const value = (el as HTMLInputElement).value
  if (typeof value === "string" && value.trim()) return value.trim()
  if (el.localName !== "input") return textOf(el)
  for (let widget = el.parentElement, depth = 0; widget && depth < 6; widget = widget.parentElement, depth++) {
    if (widget.querySelectorAll(FIELDS).length > 1) break
    const shown = Array.from(widget.querySelectorAll<HTMLElement>(VALUE_NODES))
      .map((node) => textOf(node))
      .filter(Boolean)
    if (shown.length > 0) return shown.join(", ")
  }
  return ""
}

/** What the control currently shows, as text. Groups and multi selects join their picks with ", ". */
export function readField(field: CollectedField): string {
  const el = field.el
  switch (field.kind) {
    case "select": {
      const select = el as HTMLSelectElement
      return Array.from(select.selectedOptions)
        .filter((option) => !isPlaceholderOption(option))
        .map((option) => cleanText(option.label || option.textContent))
        .join(", ")
    }
    case "radio":
    case "checkbox": {
      const picked = field.choices.filter((choice) => (choice.el as HTMLInputElement).checked)
      if (field.kind === "checkbox" && field.choices.length === 1) return picked.length ? "true" : "false"
      return picked.map((choice) => choice.text).join(", ")
    }
    case "file":
      return Array.from((el as HTMLInputElement).files ?? [])
        .map((file) => file.name)
        .join(", ")
    case "contenteditable":
      return (el.innerText ?? el.textContent ?? "").trim()
    case "combobox":
      return adapterRead(adapterFor(el), el) ?? readCombobox(el)
    default:
      return (el as HTMLInputElement).value
  }
}
