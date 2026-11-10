import { cleanText, textOf } from "./dom"
import type { CollectedField } from "./types"

function readCombobox(el: HTMLElement): string {
  const value = (el as HTMLInputElement).value
  if (typeof value === "string" && value.trim()) return value.trim()
  if (el.localName !== "input") return textOf(el)
  const wrapper = el.parentElement
  if (
    !wrapper ||
    wrapper.querySelector("label,[role=listbox],select,textarea") ||
    wrapper.querySelectorAll("input").length > 1
  )
    return ""
  const shown = textOf(wrapper)
  return shown.length <= 100 ? shown : ""
}

/** What the control currently shows, as text. Groups and multi selects join their picks with ", ". */
export function readField(field: CollectedField): string {
  const el = field.el
  switch (field.kind) {
    case "select": {
      const select = el as HTMLSelectElement
      return Array.from(select.selectedOptions)
        .filter((option) => option.value !== "")
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
      return readCombobox(el)
    default:
      return (el as HTMLInputElement).value
  }
}
