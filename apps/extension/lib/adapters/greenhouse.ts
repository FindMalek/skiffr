import { fillCombobox } from "../fill/fill-field"
import { isConsentBox } from "./shared"
import type { Adapter } from "./types"

const DEMOGRAPHIC = "#demographic-section, .demographic--container, #eeoc_fields, #demographic_questions"
const LOCATION_ID = "candidate-location"
const LOCATION_WAIT_MS = 4_000

export function createGreenhouseAdapter(): Adapter {
  return {
    id: "greenhouse",
    scope: (doc) => doc.querySelector("form#application-form, form#application_form"),
    skip: (el) => el.closest(DEMOGRAPHIC) !== null || isConsentBox(el),
    // the city list comes from a search that answers after the generic wait
    fill: async (field, value) =>
      field.kind === "combobox" && field.el.id === LOCATION_ID
        ? fillCombobox(field, value, { typedWaitMs: LOCATION_WAIT_MS })
        : undefined,
  }
}
