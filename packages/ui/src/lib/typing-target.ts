const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"])

const TEXT_ROLES = '[role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"]'

/**
 * True when a key press on `target` is the user typing or picking text: a text input, a textarea, a select, a
 * contenteditable region or a custom textbox / combobox. Plain buttons, checkboxes and radios are not.
 * Global key handlers must leave these alone.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type)
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target.closest('[contenteditable]:not([contenteditable="false"])')) return true
  return target.closest(TEXT_ROLES) !== null
}
