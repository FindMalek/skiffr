import { blurEl, cleanText, click, focusEl, settle, typeInto, waitFor } from "../fill/dom"
import { matchOption } from "../fill/match"
import { readField } from "../fill/read"
import type { CollectedField, FillResult } from "../fill/types"
import { isConsentBox, labelText } from "./shared"
import type { Adapter } from "./types"

const SECTIONS =
  '[data-qa="eeo-section"], .eeo-section, [id^="eeoSurvey"], [id^="countrySurvey"], [id^="surveySection"], #candidatePronounsCheckboxes'
const QUESTION = ".application-question"
const LOCATION = "input.location-input"
const RESULTS_WAIT_MS = 4_000

/** Lever clears the field on blur unless a suggestion was picked, so the text is typed and a suggestion is clicked. */
async function fillLocation(field: CollectedField, value: string): Promise<FillResult> {
  const el = field.el as HTMLInputElement
  const rows = () =>
    Array.from(el.closest(".application-field")?.querySelectorAll<HTMLElement>(".dropdown-location") ?? [])
  await typeInto(el, value)
  await waitFor(() => rows().length > 0, RESULTS_WAIT_MS)
  const list = rows()
  const hit = matchOption(
    value,
    list.map((row) => ({ text: cleanText(row.textContent) })),
  )
  const row = hit ? list[hit.index] : undefined
  if (!row) {
    blurEl(el)
    return { status: "failed", reason: `no location suggestion for "${value.slice(0, 60)}"`, value: el.value }
  }
  focusEl(el)
  click(row)
  await settle(30)
  blurEl(el)
  await settle()
  return el.value
    ? { status: "filled", value: readField(field) }
    : { status: "failed", reason: "the page cleared the location", value: readField(field) }
}

export function createLeverAdapter(): Adapter {
  return {
    id: "lever",
    scope: (doc) => doc.querySelector("form#application-form"),
    skip: (el) => el.closest(SECTIONS) !== null || isConsentBox(el),
    // the wrapping label also holds the location list's helper texts
    fieldLabel: (el) => {
      if (el.matches("input[type=checkbox], input[type=radio]")) return undefined
      const question = el.closest(QUESTION)
      const controls = question?.querySelectorAll("input:not([type=hidden]), select, textarea").length
      if (!question || controls !== 1) return undefined
      return labelText(question.querySelector(".application-label"))
    },
    fill: async (field, value) =>
      field.kind === "text" && field.el.matches(LOCATION) ? fillLocation(field, value) : undefined,
  }
}
