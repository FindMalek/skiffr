import { cleanText, settle, textOf } from "../fill/dom"
import { matchOption } from "../fill/match"
import { readField } from "../fill/read"
import type { CollectedField, FillResult } from "../fill/types"

const CONSENT = /\b(agree|consent|acknowledg\w*|accept|terms|privacy|gdpr|data processing|confirm)\b/i

/** What names a checkbox: its labels and the legend of its fieldset. */
function boxText(box: HTMLElement): string {
  const doc = box.ownerDocument
  const parts: string[] = []
  const wrapping = box.closest("label")
  if (wrapping) parts.push(textOf(wrapping))
  if (box.id) {
    for (const label of Array.from(doc.querySelectorAll("label[for]"))) {
      if (label.getAttribute("for") === box.id) parts.push(textOf(label))
    }
  }
  const legend = box.closest("fieldset")?.querySelector(":scope > legend")
  if (legend) parts.push(textOf(legend))
  return parts.join(" ")
}

/** A box that says the person agrees, consents or acknowledges: theirs to tick, never filled for them. */
export function isConsentBox(el: HTMLElement): boolean {
  return el.localName === "input" && (el as HTMLInputElement).type === "checkbox" && CONSENT.test(boxText(el))
}

export const labelText = (node: Element | null | undefined): string | undefined =>
  node ? cleanText(node.textContent) || undefined : undefined

/** Picks the option of a row of buttons or radios that matches the value, then checks that the page took it. */
export async function fillChoiceRow(
  field: CollectedField,
  value: string,
  press: (choice: HTMLElement) => void,
  isOn: (choice: HTMLElement) => boolean,
): Promise<FillResult> {
  const hit = matchOption(
    value,
    field.choices.map((choice) => ({ text: choice.text })),
  )
  const choice = hit ? field.choices[hit.index] : undefined
  if (!choice) return { status: "failed", reason: `no option matches "${value.slice(0, 60)}"`, value: readField(field) }
  if (isOn(choice.el)) return { status: "unchanged", value: readField(field) }
  press(choice.el)
  await settle(30)
  return isOn(choice.el)
    ? { status: "filled", value: readField(field) }
    : { status: "failed", reason: "the page did not keep the choice", value: readField(field) }
}
