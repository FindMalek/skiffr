export type Signal = "name" | "email" | "phone" | "resume" | "coverLetter"

export type ControlInfo = { el: HTMLElement; signals: Signal[]; blocker: string | null }

const CONTROL_SELECTOR = "input, textarea, select"
const IGNORED_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "range", "color"])
const PERSON_PREFIX = new Set([
  "first",
  "last",
  "full",
  "given",
  "family",
  "sur",
  "legal",
  "preferred",
  "your",
  "systemfield",
])
const COMPOUND_NAMES = new Set([
  "firstname",
  "lastname",
  "fullname",
  "givenname",
  "familyname",
  "surname",
  "fname",
  "lname",
])
const PHONE_TOKENS = new Set(["phone", "mobile", "tel", "telephone", "cell"])
const RESUME_PATTERN = /resume|\bcv\b|curriculum|résumé/i
const COVER_PATTERN = /cover[\s_-]?letter/i
const PAYMENT_PHRASE = /\b(card number|credit card|cvv|cvc|expiry date|billing address|iban)\b/
const MAX_LABEL_LENGTH = 60
export const MAX_CONTROLS = 400
const TIME_BUDGET_MS = 40

type VisibilityElement = HTMLElement & { checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean }

function isVisible(el: HTMLElement): boolean {
  const target = el as VisibilityElement
  if (typeof target.checkVisibility === "function") return target.checkVisibility({ visibilityProperty: true })
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden) return false
    const style = node.ownerDocument.defaultView?.getComputedStyle(node)
    if (style?.display === "none" || (node === el && style?.visibility === "hidden")) return false
  }
  return true
}

function tokens(part: string): string[] {
  return part
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function isNamePart(part: string): boolean {
  const words = tokens(part)
  if (words.some((word) => COMPOUND_NAMES.has(word))) return true
  const at = words.indexOf("name")
  if (at === -1) return false
  return words.length === 1 || PERSON_PREFIX.has(words[at - 1] ?? "")
}

function labelTexts(el: HTMLElement): string[] {
  const texts: string[] = []
  const labels = (el as HTMLInputElement).labels
  if (labels) for (const label of labels) texts.push(label.textContent ?? "")
  const wrapping = el.closest("label")
  if (wrapping) texts.push(wrapping.textContent ?? "")
  const labelledBy = el.getAttribute("aria-labelledby")
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) texts.push(el.ownerDocument.getElementById(id)?.textContent ?? "")
  }
  return texts
}

function attributeTexts(el: HTMLElement): string[] {
  return ["name", "id", "placeholder", "aria-label", "data-qa", "data-automation-id", "data-testid"]
    .map((attribute) => el.getAttribute(attribute) ?? "")
    .filter(Boolean)
}

function surroundingText(el: HTMLElement): string {
  let text = ""
  let node = el.parentElement
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    if (node.querySelectorAll(CONTROL_SELECTOR).length > 1) break
    text = node.textContent?.slice(0, 200) ?? ""
  }
  return text
}

function isPaymentField(el: HTMLElement, type: string, autocomplete: string, parts: string[]): boolean {
  if (autocomplete.startsWith("cc-")) return true
  const names = [el.getAttribute("name") ?? "", el.id].map((part) => tokens(part).join(" "))
  if (names.some((name) => PAYMENT_PHRASE.test(name))) return true
  if (type === "textarea") return false
  return parts.some((part) => part.length <= MAX_LABEL_LENGTH && PAYMENT_PHRASE.test(tokens(part).join(" ")))
}

function analyze(el: HTMLElement, type: string): ControlInfo {
  const parts = [...attributeTexts(el), ...labelTexts(el)]
  const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase()
  const signals: Signal[] = []
  const words = parts.flatMap(tokens)

  if (/^(name|given-name|family-name)$/.test(autocomplete) || parts.some(isNamePart)) signals.push("name")
  if (type === "email" || autocomplete === "email" || words.includes("email") || parts.some((p) => /e-?mail/i.test(p)))
    signals.push("email")
  if (type === "tel" || autocomplete.startsWith("tel") || words.some((word) => PHONE_TOKENS.has(word)))
    signals.push("phone")
  if (type === "file" || type === "textarea") {
    const text = [...parts, surroundingText(el)].join(" ")
    if (type === "file" && RESUME_PATTERN.test(text)) signals.push("resume")
    if (COVER_PATTERN.test(text)) signals.push("coverLetter")
  }

  let blocker: string | null = null
  if (type === "password") blocker = "password field"
  else if (isPaymentField(el, type, autocomplete, parts)) blocker = "payment field"
  else if (type === "search") blocker = "search field"
  return { el, signals, blocker }
}

export function collectControls(root: ParentNode): ControlInfo[] {
  const controls: ControlInfo[] = []
  const started = Date.now()
  for (const node of root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const type =
      node.tagName === "INPUT" ? ((node as HTMLInputElement).type || "text").toLowerCase() : node.tagName.toLowerCase()
    if (IGNORED_TYPES.has(type) || (node as HTMLInputElement).disabled) continue
    const visibleTarget = type === "file" ? (node.parentElement ?? node) : node
    if (!isVisible(visibleTarget)) continue
    controls.push(analyze(node, type))
  }
  return controls
}

export function countControlCandidates(root: ParentNode): number {
  return root.querySelectorAll(CONTROL_SELECTOR).length
}
