import { cleanText, click } from "../fill/dom"
import { fillChoiceRow, isConsentBox, labelText } from "./shared"
import type { Adapter } from "./types"

const RADIO_GROUP = "fieldset[role=radiogroup]"
const SURVEY = /\b(equal opportunity|eeo|diversity|demographic|self[- ]identif\w*)\b/i

const options = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLElement>("[role=radio]"))
const checked = (option: HTMLElement) => option.getAttribute("aria-checked") === "true"

export function createWorkableAdapter(): Adapter {
  return {
    id: "workable",
    scope: (doc) => doc.querySelector("form[data-ui=application-form]"),
    skip: (el) => {
      if (el.matches("[role=radio] input") || isConsentBox(el)) return true
      return SURVEY.test(el.closest("section[data-ui=section]")?.querySelector("h2")?.textContent ?? "")
    },
    // the wrapping label also carries the "(Optional)" note, the labelledby target is only the question
    fieldLabel: (el) => {
      const id = el.getAttribute("aria-labelledby")?.split(/\s+/)[0]
      return id?.endsWith("_label") ? labelText(el.ownerDocument.getElementById(id)) : undefined
    },
    // the radios inside are aria-hidden, the group is what a person answers
    fieldKind: (el) => (el.matches(RADIO_GROUP) ? "combobox" : undefined),
    fieldChoices: (el) => (el.matches(RADIO_GROUP) ? options(el) : undefined),
    readValue: (el) => (el.matches(RADIO_GROUP) ? cleanText(options(el).find(checked)?.textContent) : undefined),
    fill: async (field, value) =>
      field.el.matches(RADIO_GROUP)
        ? fillChoiceRow(field, value, (option) => click(option.querySelector("label") ?? option), checked)
        : undefined,
  }
}
