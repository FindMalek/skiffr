import {
  type CollectedField,
  collectFields,
  currentValue,
  type FieldMapping,
  type FillPageInput,
  type FillSummary,
  fillPage,
  highlightField,
} from "./fill"
import { FILL_CONFIDENCE_REVIEW, FILL_FIELDS_MAX, type FillErrorCode } from "./fill-config"
import { createNoiseFilter, type NoiseFilter } from "./fill-scope"

export type MappingResult = Pick<FillPageInput, "mapping" | "values" | "files"> & {
  /** Fields with a saved answer from a similar question: outlined for the person, never filled. */
  suggestions?: string[]
  /** Part of the work failed on the way, the rest is still good. */
  problem?: FillErrorCode
}
export type MappingProvider = (fields: CollectedField[]) => Promise<MappingResult | null>
export type FillOutcome =
  | {
      ok: true
      summary: FillSummary
      /** Fields now holding a filled value in the page. */
      filled: number
      /** Of those, the ones outlined for the person to check. */
      review: number
      /** Empty fields outlined because a similar saved answer exists. */
      suggested: number
      problem?: FillErrorCode
    }
  | { ok: false; code: FillErrorCode; reason: string }

/** A failure the provider can name, so the page says something useful instead of "failed". */
export class FillRequestError extends Error {
  constructor(readonly code: FillErrorCode) {
    super(code)
  }
}

export type FillObserver = (done: {
  root: ParentNode
  /** The fields that were asked about and are still on the page. */
  fields: CollectedField[]
  mapping: FieldMapping[]
  summary: FillSummary
}) => void

const NO_PROVIDER: MappingProvider = async () => null
let provider: MappingProvider = NO_PROVIDER
let observer: FillObserver | null = null

/** Where the field mapping comes from. Until one is set nothing is filled. */
export function setMappingProvider(next: MappingProvider | null): void {
  provider = next ?? NO_PROVIDER
}

/** Told after each fill that asked about fields, so what the person does next can be learned from. */
export function setFillObserver(next: FillObserver | null): void {
  observer = next
}

const NEVER_ASKED = new Set(["password", "hidden", "file"])
const SENSITIVE_AUTOCOMPLETE = /(^|\s)(current-password|new-password|one-time-code|cc-[a-z-]+)(\s|$)/i

/** Fields worth asking about: never secrets, uploads or search boxes, and never one that already holds a value, so typed text stays on the page. */
function askable(field: CollectedField, isNoise: NoiseFilter): boolean {
  if (field.kind === "file" || NEVER_ASKED.has(field.descriptor.type ?? "") || field.descriptor.type === "search")
    return false
  if (isNoise(field.el)) return false
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

const hrefOf = (root: ParentNode): string => ((root as Document).location ?? root.ownerDocument?.location)?.href ?? ""

async function run(start: ParentNode): Promise<FillOutcome> {
  try {
    clearOutlines()
    const root = start
    const href = hrefOf(start)
    const isNoise = createNoiseFilter((start.nodeType === 9 ? start : start.ownerDocument) as Document)
    const asked = collectFields(root)
      .filter((field) => askable(field, isNoise))
      .slice(0, FILL_FIELDS_MAX)
    const mapped = asked.length > 0 ? await provider(asked) : { mapping: [], values: {} }
    if (!mapped) return { ok: false, code: "failed", reason: "no mapping provider" }
    // the page moved on while the worker was busy: what it answered is for a form that is no longer there
    const fields = asked.filter((field) => field.el.isConnected)
    if (hrefOf(start) !== href || (asked.length > 0 && fields.length === 0)) {
      return { ok: false, code: "changed", reason: "page changed" }
    }
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
      release.push(highlightField(field, "skiffr has a suggestion for this field, please check"))
      suggested++
    }
    clearOutlines = () => {
      for (const undo of release.splice(0)) undo()
    }
    if (fields.length > 0) observer?.({ root, fields, mapping: mapped.mapping, summary })
    const alive = new Set(fields.filter((field) => field.el.isConnected).map((field) => field.id))
    const filled = summary.fields.filter((f) => f.status === "filled" && alive.has(f.id))
    const review = filled.filter((f) => f.lowConfidence).length
    return {
      ok: true,
      summary,
      filled: filled.length,
      review,
      suggested,
      ...(mapped.problem ? { problem: mapped.problem } : {}),
    }
  } catch (error) {
    if (error instanceof FillRequestError) return { ok: false, code: error.code, reason: error.code }
    return { ok: false, code: "failed", reason: error instanceof Error ? error.message : "fill failed" }
  }
}
