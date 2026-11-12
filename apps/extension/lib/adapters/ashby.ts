import { cleanText, click } from "../fill/dom"
import { fillCombobox } from "../fill/fill-field"
import { fillChoiceRow, labelText } from "./shared"
import type { Adapter } from "./types"

const YES_NO = ".ashby-application-form-input-yesno"
const AUTOCOMPLETE = "input.ashby-application-form-input-autocomplete"
const LOCATION_WAIT_MS = 4_000

// a button with no type is a submit button inside a form: never a choice
const buttons = (group: HTMLElement) =>
  Array.from(group.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.type !== "submit")
const pressed = (button: HTMLElement) => button.getAttribute("aria-pressed") === "true"

export function createAshbyAdapter(): Adapter {
  return {
    id: "ashby",
    scope: (doc) => doc.querySelector(".ashby-application-form-container")?.closest("form") ?? null,
    skip: (el) => el.closest(".ashby-survey-form-container") !== null || el.matches(`${YES_NO} > input`),
    // the label points at an id the autocomplete input does not have, so its own title is read from the entry
    fieldLabel: (el) =>
      labelText(el.closest("[data-field-path]")?.querySelector(".ashby-application-form-question-title")),
    fieldKind: (el) => (el.matches(YES_NO) ? "combobox" : undefined),
    fieldChoices: (el) => (el.matches(YES_NO) ? buttons(el) : undefined),
    readValue: (el) => (el.matches(YES_NO) ? cleanText(buttons(el).find(pressed)?.textContent) : undefined),
    fill: async (field, value) => {
      if (field.el.matches(YES_NO)) return fillChoiceRow(field, value, click, pressed)
      if (field.el.matches(AUTOCOMPLETE)) return fillCombobox(field, value, { typedWaitMs: LOCATION_WAIT_MS })
      return undefined
    },
  }
}
