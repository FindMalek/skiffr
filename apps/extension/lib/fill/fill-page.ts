import { collectFields } from "./collect"
import { parentOf, settle } from "./dom"
import { fillCollected } from "./fill-field"
import { highlightField } from "./highlight"
import { matchOption, sameValue } from "./match"
import { readField } from "./read"
import { beginFill } from "./state"
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
  /** Replace a value a person or the page already put in. Off by default. */
  overwrite?: boolean
  /** Explicit locale for dates and numbers whose order or separators are otherwise ambiguous. */
  locale?: string
}

const LOW_CONFIDENCE = 0.6
const RESUME = /(^|[^a-z])(resume|résumé|cv|curriculum)([^a-z]|$)/i
const NOT_RESUME = /(^|[^a-z])(cover|photo|picture|avatar|portrait|headshot|portfolio|transcript|certificate|passport)/i

/** Text that says what a file input is for: its label and section, and the names the page gave it and its wrappers. */
function slotText(field: CollectedField): string {
  const { el, descriptor, info } = field
  const parts = [descriptor.label, descriptor.name, descriptor.ariaLabel, info.section, el.getAttribute("accept")]
  let node: HTMLElement | null = el
  for (let depth = 0; node && depth < 4; depth++, node = parentOf(node)) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.startsWith("data-") || ["id", "name", "class", "aria-label"].includes(attribute.name))
        parts.push(attribute.value)
    }
  }
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
}

/** The resume input: one that says resume or cv, else the only upload on the page. Photo and cover letter slots never qualify. */
function resumeSlot(fields: CollectedField[]): CollectedField | undefined {
  const uploads = fields.filter((field) => field.kind === "file")
  const open = uploads.filter((field) => !NOT_RESUME.test(slotText(field)))
  return open.find((field) => RESUME.test(slotText(field))) ?? (uploads.length === 1 ? open[0] : undefined)
}

/** The value a person or the page already put in, empty when there is none. A prompt option is not a value. */
export function currentValue(field: CollectedField): string {
  if (field.kind === "checkbox" || field.kind === "file") return ""
  if (field.kind === "combobox" && field.el.localName === "input") return (field.el as HTMLInputElement).value.trim()
  return readField(field).trim()
}

function alreadyHas(field: CollectedField, value: string): string | null {
  const current = currentValue(field)
  if (!current || sameValue(current, value)) return null
  if (field.kind !== "text" && field.kind !== "textarea" && matchOption(value, [{ text: current }])) return null
  return current
}

/** Applies a field mapping in document order. Never submits and never clicks submit, next or apply buttons; it only clicks checkboxes, radios and custom dropdowns with their options. Never touches password or hidden inputs. */
export async function fillPage(input: FillPageInput): Promise<FillSummary> {
  const done = beginFill()
  try {
    return await run(input)
  } finally {
    done()
  }
}

async function run(input: FillPageInput): Promise<FillSummary> {
  const fields = input.fields ?? collectFields(input.root ?? document)
  const mapping = new Map(input.mapping.map((entry) => [entry.id, entry]))
  const threshold = input.lowConfidence ?? LOW_CONFIDENCE
  const resume = input.files?.resume ? resumeSlot(fields) : undefined
  const outcomes: FieldOutcome[] = []
  const attempts: { field: CollectedField; outcome: FieldOutcome }[] = []
  const releases: (() => void)[] = []

  for (const field of fields) {
    const base = { id: field.id, label: field.descriptor.label, lowConfidence: false }
    if (field.kind === "file") {
      if (field !== resume || !input.files?.resume) continue
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
    const current = input.overwrite ? null : alreadyHas(field, value)
    if (current) {
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
