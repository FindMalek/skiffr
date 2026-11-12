import { isSensitiveQuestion } from "@skiffr/ai/learnable"
import { cleanText, containsControl, parentOf, textOf } from "./dom"

/** A page title is no section: only the headings below it say what a block of questions is. */
const HEADING = "h2,h3,h4,h5,h6,[role=heading]:not([aria-level='1']),legend"
const LEVELS_MAX = 10
const SIBLINGS_MAX = 25
const CONTEXT_MAX = 300
const CONTEXT_LEVELS = 2

export type HeadingMemo = Map<HTMLElement, string>

/** The nearest heading before a node among its siblings, or nothing. Looks inside siblings that hold no control. */
function headingBefore(node: HTMLElement, memo: HeadingMemo): string {
  const known = memo.get(node)
  if (known !== undefined) return known
  let found = ""
  let scanned = 0
  for (let sibling = node.previousElementSibling; sibling && scanned < SIBLINGS_MAX; scanned++) {
    if (sibling.matches(HEADING)) {
      found = textOf(sibling)
      break
    }
    if (!containsControl(sibling)) {
      const nested = Array.from(sibling.querySelectorAll(HEADING)).at(-1)
      if (nested && textOf(nested)) {
        found = textOf(nested)
        break
      }
    }
    sibling = sibling.previousElementSibling
  }
  memo.set(node, found)
  return found
}

/** Every heading, legend and group name above a control, one per level up to the form: the sections it sits under. */
export function sectionsAbove(el: HTMLElement, memo: HeadingMemo): string[] {
  const out: string[] = []
  let node: HTMLElement | null = el
  for (let depth = 0; node && depth < LEVELS_MAX; depth++, node = parentOf(node)) {
    if (node.localName === "body" || node.localName === "html") break
    const legend = node.localName === "fieldset" ? node.querySelector(":scope > legend") : null
    const named = node === el ? "" : cleanText(node.getAttribute("aria-label"))
    for (const text of [legend ? textOf(legend) : "", named, headingBefore(node, memo)]) if (text) out.push(text)
    if (node.localName === "form") break
  }
  return out
}

/** The words next to a control that a person reads as its question: its fieldset legend and the row it sits in. */
export function textsAround(el: HTMLElement): string[] {
  const out: string[] = []
  const legend = el.closest("fieldset")?.querySelector(":scope > legend")
  if (legend) out.push(textOf(legend))
  let node: HTMLElement | null = el
  for (let level = 0; node && level < CONTEXT_LEVELS; level++, node = parentOf(node)) {
    const row = parentOf(node)
    if (!row || row.localName === "form" || row.localName === "body") break
    if (row.querySelectorAll("input:not([type=hidden]), select, textarea, [role=combobox]").length > 1) break
    const text = textOf(row)
    if (text && text.length <= CONTEXT_MAX) out.push(text)
  }
  return out
}

export type ControlWords = {
  /** Every label the generic collector and the page gave the control. */
  labels: (string | undefined)[]
  name?: string
  autocomplete?: string
  options: string[]
}

/** The central guard: a question about consent, a protected category or an answer only the person gives is never read, on any site. */
export function isSensitiveControl(el: HTMLElement, words: ControlWords, memo: HeadingMemo): boolean {
  const sections = sectionsAbove(el, memo)
  const labels = [...words.labels, ...textsAround(el)].filter((label): label is string => Boolean(label))
  const shared = { name: words.name, autocomplete: words.autocomplete, options: words.options, sections }
  return (
    isSensitiveQuestion({ ...shared, label: labels[0] }) ||
    labels.slice(1).some((label) => isSensitiveQuestion({ label }))
  )
}
