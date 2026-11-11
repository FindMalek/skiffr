import { detectApplicationForm } from "./detect/score"
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

const NO_PROVIDER: MappingProvider = async () => null
let provider: MappingProvider = NO_PROVIDER

/** Where the field mapping comes from. Until one is set nothing is filled. */
export function setMappingProvider(next: MappingProvider | null): void {
  provider = next ?? NO_PROVIDER
}

const NEVER_ASKED = new Set(["password", "hidden", "file"])
const SENSITIVE_AUTOCOMPLETE = /(^|\s)(current-password|new-password|one-time-code|cc-[a-z-]+)(\s|$)/i

const NOISE_FORM = /newsletter|subscri|comment|search/i

/** A search box, or a form for a newsletter, comments or search: never part of an application. */
function inNoiseForm(el: HTMLElement): boolean {
  const form = el.closest("form, [role=search]")
  if (!form) return false
  if (form.getAttribute("role") === "search") return true
  const submits = Array.from(form.querySelectorAll("button, input[type=submit]"))
    .slice(0, 4)
    .map((button) => button.textContent || (button as HTMLInputElement).value || "")
  const own = ["id", "class", "action", "name", "aria-label"].map((name) => form.getAttribute(name) ?? "")
  return NOISE_FORM.test([...own, ...submits].join(" "))
}

/** A whole page is scoped to the form the detector picked; a page it found no form on is used as it is, minus the noise. */
function scopeOf(root: ParentNode): { root: ParentNode; scoped: boolean } {
  if (root.nodeType !== 9) return { root, scoped: true }
  const doc = root as Document
  const container = detectApplicationForm(doc).container
  if (container && container !== doc.body && container !== doc.documentElement) return { root: container, scoped: true }
  return { root: doc, scoped: false }
}

/** Fields worth asking about: never secrets, uploads or search boxes, and never one that already holds a value, so typed text stays on the page. */
function askable(field: CollectedField, scoped: boolean): boolean {
  if (field.kind === "file" || NEVER_ASKED.has(field.descriptor.type ?? "") || field.descriptor.type === "search")
    return false
  if (!scoped && inNoiseForm(field.el)) return false
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
    const { root, scoped } = scopeOf(start)
    const href = hrefOf(start)
    const asked = collectFields(root)
      .filter((field) => askable(field, scoped))
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
      release.push(highlightField(field, "Skiffr has a suggestion for this field, please check"))
      suggested++
    }
    clearOutlines = () => {
      for (const undo of release.splice(0)) undo()
    }
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
