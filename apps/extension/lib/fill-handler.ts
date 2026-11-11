import {
  type CollectedField,
  collectFields,
  currentValue,
  type FillPageInput,
  type FillSummary,
  fillPage,
  highlightField,
} from "./fill"
import { FILL_CONFIDENCE_REVIEW, FILL_FIELDS_MAX, type FillErrorCode } from "./fill-config"

export type MappingResult = Pick<FillPageInput, "mapping" | "values" | "files"> & {
  /** Fields with a saved answer from a similar question: outlined for the person, never filled. */
  suggestions?: string[]
  /** Part of the work failed on the way, the rest is still good. */
  problem?: FillErrorCode
}
export type MappingProvider = (fields: CollectedField[]) => Promise<MappingResult | null>
export type FillOutcome =
  | { ok: true; summary: FillSummary; filled: number; review: number; problem?: FillErrorCode }
  | { ok: false; code: FillErrorCode; reason: string }

/** A failure the provider can name, so the page says something useful instead of "failed". */
export class FillRequestError extends Error {
  constructor(readonly code: FillErrorCode) {
    super(code)
  }
}

const NO_PROVIDER: MappingProvider = async () => null
let provider: MappingProvider = NO_PROVIDER

/** Where the field mapping comes from. Until one is set nothing is filled. */
export function setMappingProvider(next: MappingProvider | null): void {
  provider = next ?? NO_PROVIDER
}

const NEVER_ASKED = new Set(["password", "hidden", "file"])
const SENSITIVE_AUTOCOMPLETE = /(^|\s)(current-password|new-password|one-time-code|cc-[a-z-]+)(\s|$)/i

/** Fields worth asking about: never secrets or uploads, and never one that already holds a value, so typed text stays on the page. */
function askable(field: CollectedField): boolean {
  if (field.kind === "file" || NEVER_ASKED.has(field.descriptor.type ?? "")) return false
  if (SENSITIVE_AUTOCOMPLETE.test(field.info.autocomplete ?? "")) return false
  return currentValue(field) === ""
}

let clearOutlines: () => void = () => {}

export async function handleFill(root: ParentNode = document): Promise<FillOutcome> {
  const outcome = await run(root)
  if (import.meta.env.DEV)
    console.debug("[skiffr] fill requested", outcome.ok ? outcome.summary.counts : outcome.reason)
  return outcome
}

async function run(root: ParentNode): Promise<FillOutcome> {
  try {
    clearOutlines()
    const fields = collectFields(root).filter(askable).slice(0, FILL_FIELDS_MAX)
    const mapped = fields.length > 0 ? await provider(fields) : { mapping: [], values: {} }
    if (!mapped) return { ok: false, code: "failed", reason: "no mapping provider" }
    const summary = await fillPage({
      mapping: mapped.mapping,
      values: mapped.values,
      files: mapped.files,
      root,
      fields,
      lowConfidence: FILL_CONFIDENCE_REVIEW,
    })
    const release = [summary.clearHighlights]
    const wanted = new Set(mapped.suggestions ?? [])
    let suggested = 0
    for (const field of fields) {
      if (!wanted.has(field.id) || currentValue(field) !== "") continue
      release.push(highlightField(field))
      suggested++
    }
    clearOutlines = () => {
      for (const undo of release.splice(0)) undo()
    }
    const filled = summary.counts.filled
    const review = summary.fields.filter((f) => f.status === "filled" && f.lowConfidence).length + suggested
    return { ok: true, summary, filled, review, ...(mapped.problem ? { problem: mapped.problem } : {}) }
  } catch (error) {
    if (error instanceof FillRequestError) return { ok: false, code: error.code, reason: error.code }
    return { ok: false, code: "failed", reason: error instanceof Error ? error.message : "fill failed" }
  }
}
