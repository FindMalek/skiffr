import { collectFields } from "./collect"
import { settle } from "./dom"
import { fillCollected } from "./fill-field"
import { highlightField } from "./highlight"
import { sameValue } from "./match"
import { readField } from "./read"
import type { CollectedField, FieldMapping, FieldOutcome, FillFileSlots, FillStatus, FillSummary } from "./types"

export type FillPageInput = {
  root?: ParentNode
  /** Fields from an earlier `collectFields` pass; collected again from `root` when left out. */
  fields?: CollectedField[]
  mapping: FieldMapping[]
  /** Flattened profile, key to value. */
  values: Record<string, string>
  files?: FillFileSlots
  /** Fields mapped below this confidence get an outline. */
  lowConfidence?: number
  /** Replace text a person or the page already put in. Off by default. */
  overwrite?: boolean
  locale?: string
}

const LOW_CONFIDENCE = 0.6
const RESUME = /(^|[^a-z])(resume|cv|curriculum)([^a-z]|$)/i
const TYPED = new Set(["text", "textarea", "contenteditable", "combobox"])

const isResumeSlot = (field: CollectedField) =>
  field.kind === "file" &&
  [field.descriptor.label, field.descriptor.name, field.descriptor.ariaLabel, field.el.id].some((text) =>
    RESUME.test(text ?? ""),
  )

const typedValue = (field: CollectedField) =>
  (field.kind === "combobox" && field.el.localName === "input"
    ? (field.el as HTMLInputElement).value
    : readField(field)
  ).trim()

/** Applies a field mapping in document order. Never submits, never clicks a button, never touches password or hidden inputs. */
export async function fillPage(input: FillPageInput): Promise<FillSummary> {
  const fields = input.fields ?? collectFields(input.root ?? document)
  const mapping = new Map(input.mapping.map((entry) => [entry.id, entry]))
  const threshold = input.lowConfidence ?? LOW_CONFIDENCE
  const outcomes: FieldOutcome[] = []
  const attempts: { field: CollectedField; outcome: FieldOutcome }[] = []
  const releases: (() => void)[] = []
  let resumeTaken = false

  for (const field of fields) {
    const base = { id: field.id, label: field.descriptor.label, lowConfidence: false }
    if (field.kind === "file") {
      if (!input.files?.resume || resumeTaken || !isResumeSlot(field)) continue
      resumeTaken = true
      const outcome: FieldOutcome = { ...base, source: "file", ...(await fillCollected(field, input.files.resume)) }
      outcomes.push(outcome)
      attempts.push({ field, outcome })
      continue
    }
    const entry = mapping.get(field.id)
    if (!entry) continue
    const source = entry.action === "generate" ? "generate" : "profile"
    const meta = {
      ...base,
      source,
      key: entry.action === "profile" ? entry.key : undefined,
      confidence: entry.confidence,
    } as const
    const lowConfidence = entry.confidence < threshold
    if (entry.action === "skip") {
      outcomes.push({ ...meta, status: "skipped", reason: entry.reason || "mapped to skip" })
      continue
    }
    const value = entry.action === "profile" ? input.values[entry.key] : entry.value
    if (!value?.trim()) {
      outcomes.push({
        ...meta,
        status: "skipped",
        reason: `no value for ${entry.action === "profile" ? entry.key : "field"}`,
      })
      continue
    }
    const current = TYPED.has(field.kind) ? typedValue(field) : ""
    if (!input.overwrite && current && !sameValue(current, value)) {
      outcomes.push({ ...meta, status: "skipped", reason: "already has a value", value: current })
      continue
    }
    const result = await fillCollected(field, value, { locale: input.locale })
    const outcome: FieldOutcome = { ...meta, lowConfidence, ...result }
    outcomes.push(outcome)
    attempts.push({ field, outcome })
    if (lowConfidence && result.status === "filled") releases.push(highlightField(field))
  }

  await settle(100)
  for (const { field, outcome } of attempts) {
    if (outcome.status === "filled" && outcome.value !== undefined && !sameValue(readField(field), outcome.value)) {
      outcome.status = "failed"
      outcome.reason = "the page changed the value after the fill"
    }
  }

  const counts: Record<FillStatus, number> = { filled: 0, unchanged: 0, failed: 0, skipped: 0 }
  for (const outcome of outcomes) counts[outcome.status]++
  return {
    fields: outcomes,
    counts,
    clearHighlights: () => {
      for (const release of releases.splice(0)) release()
    },
  }
}
