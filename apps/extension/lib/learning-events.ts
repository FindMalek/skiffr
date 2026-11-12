import { isLearnableField, isSensitiveValue } from "@skiffr/ai/learnable"
import {
  type FieldEventInput,
  fieldEventInputSchema,
  LEARNING_AUTOFILL_VALUE_MAX,
  LEARNING_FIELDS_MAX,
  LEARNING_REQUEST_CHARS_MAX,
} from "@skiffr/common"
import type { CollectedField, FieldMapping } from "./fill"
import { toFillField } from "./fill-client"
import { savedAnswerReason } from "./fill-config"

export type EventSource = FieldEventInput["source"]

/** Anything past the autofill limit reads as "too long to fill" to the server, so the rest of the text is not worth sending. */
const VALUE_CAP = LEARNING_AUTOFILL_VALUE_MAX + 1

/** Where a filled value came from: the profile, a saved answer (this very form, or the answer bank), or the model. */
export function sourceOf(mapping: FieldMapping | undefined): EventSource {
  if (mapping?.action === "profile") return "profile"
  if (mapping?.action === "generate") {
    if (mapping.reason === savedAnswerReason("site")) return "site"
    if (mapping.reason === savedAnswerReason("exact") || mapping.reason === savedAnswerReason("label")) return "answer"
  }
  return "ai"
}

/** A lone checkbox reads "false" when unchecked: that is an empty answer, like a cleared text field. */
function eventValue(field: CollectedField, value: string): string {
  const text = field.kind === "checkbox" && field.choices.length === 1 && value === "false" ? "" : value
  return text.trim().slice(0, VALUE_CAP)
}

const size = (event: FieldEventInput): number =>
  [event.label, event.type, event.autocomplete, event.filledValue, event.finalValue, ...event.options].reduce<number>(
    (sum, text) => sum + (text?.length ?? 0),
    0,
  )

/** What may be recorded: never a field that is private by its label, type or autocomplete, and never a value that looks like a card, an iban or a social security number (the field stays, with no values, so the form still matches). */
export function recordable(events: FieldEventInput[]): FieldEventInput[] {
  return events
    .filter((event) => isLearnableField(event))
    .map((event) =>
      isSensitiveValue(event.filledValue) || isSensitiveValue(event.finalValue)
        ? { ...event, filledValue: "", finalValue: "" }
        : event,
    )
}

export type FieldState = { filled: string; final: string; mapping?: FieldMapping }

/**
 * One event per field that was asked about, in page order: the untouched ones (same value in and out), the cleared ones
 * and the ones that were never filled. The server needs all of them to tell which form this is. Capped like a lookup,
 * so the first batch of a long form matches the first lookup batch.
 */
export function buildEvents(
  fields: CollectedField[],
  stateOf: (field: CollectedField) => FieldState,
): FieldEventInput[] {
  const events: FieldEventInput[] = []
  for (const field of fields) {
    const { filled, final, mapping } = stateOf(field)
    const { label, type, autocomplete, options } = toFillField(field)
    const parsed = fieldEventInputSchema.safeParse({
      label,
      type,
      autocomplete,
      options,
      filledValue: eventValue(field, filled),
      finalValue: eventValue(field, final),
      source: sourceOf(mapping),
    })
    if (parsed.success) events.push(parsed.data)
    if (events.length >= LEARNING_FIELDS_MAX) break
  }
  let used = 0
  const kept: FieldEventInput[] = []
  for (const event of recordable(events)) {
    used += size(event)
    if (used > LEARNING_REQUEST_CHARS_MAX) break
    kept.push(event)
  }
  return kept
}
