import { blockSubmit, settle, textOf } from "../fill/dom"
import { matchOption } from "../fill/match"
import { readField } from "../fill/read"
import type { CollectedField, FillResult } from "../fill/types"

/** The visible words of a node, as the generic collector reads them: no style or script text, no hidden or glued parts. */
export const labelText = (node: Element | null | undefined): string | undefined =>
  (node ? textOf(node) : "") || undefined

/**
 * Picks the option of a row of buttons or radios that matches the value, then checks that the page took it. Nothing
 * the press does can submit the form: any submit event is cancelled until the page has settled.
 */
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
  const release = blockSubmit(choice.el.ownerDocument)
  try {
    press(choice.el)
    await settle(30)
  } finally {
    release()
  }
  return isOn(choice.el)
    ? { status: "filled", value: readField(field) }
    : { status: "failed", reason: "the page did not keep the choice", value: readField(field) }
}
