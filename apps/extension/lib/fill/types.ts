import type { FieldDescriptor, FieldMapping } from "@skiffr/common"

export type { FieldDescriptor, FieldMapping }

export type FieldKind = "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "contenteditable" | "combobox"

export type FillStatus = "filled" | "unchanged" | "failed" | "skipped"

export type FillResult = {
  status: FillStatus
  reason?: string
  /** What the page shows after the attempt, as read back from the control. */
  value?: string
  /** The page shows the value without a part it took elsewhere, such as the dial code of a phone number. */
  moved?: boolean
}

export type FieldChoice = { text: string; value: string; el: HTMLElement }

/** Extra hints the shared descriptor schema does not carry yet. */
export type FieldInfo = {
  required: boolean
  multiple: boolean
  maxLength?: number
  pattern?: string
  autocomplete?: string
  section?: string
  /** Another field has the same kind, label and name, so a mapping for one cannot tell them apart. */
  ambiguous?: boolean
}

export type CollectedField = {
  /** Stable for the same markup, so a mapping made from a first pass still lines up on a second one. */
  id: string
  kind: FieldKind
  /** First control of the field (first radio of a group). */
  el: HTMLElement
  /** Radio and checkbox members, select options, combobox options that were already in the DOM. */
  choices: FieldChoice[]
  descriptor: FieldDescriptor
  info: FieldInfo
}

export type FieldOutcome = FillResult & {
  id: string
  label?: string
  source: "profile" | "generate" | "file"
  /** Profile key the value came from. */
  key?: string
  confidence?: number
  lowConfidence: boolean
}

export type FillSummary = {
  fields: FieldOutcome[]
  counts: Record<FillStatus, number>
  /** Removes the review outlines added for low confidence fields. */
  clearHighlights: () => void
}

export type FillFileSlots = { resume?: File }

export type EditReport = { fieldId: string; filledValue: string; finalValue: string }
