import {
  AI_FIELD_TEXT_MAX,
  AI_FIELDS_MAX,
  AI_OPTION_TEXT_MAX,
  AI_OPTIONS_MAX,
  AI_REQUEST_CHARS_MAX,
} from "@skiffr/common"
import {
  cleanText,
  containsControl,
  hasLayout,
  isAriaHidden,
  isDisabled,
  isElement,
  isRendered,
  parentOf,
  textOf,
  view,
  walkElements,
} from "./dom"
import type { CollectedField, FieldChoice, FieldDescriptor, FieldInfo, FieldKind } from "./types"

export type Ctx = { labels: Map<Node, HTMLElement[]> }

const NOT_FILLABLE = new Set(["hidden", "password", "submit", "button", "reset", "image", "color", "range"])
const BAIT = new Set([
  "website2",
  "url2",
  "homepage",
  "fax",
  "phone2",
  "email2",
  "hp",
  "hpot",
  "honey",
  "honeypot",
  "trap",
  "bot",
  "botcheck",
  "nospam",
  "leaveblank",
  "donotfill",
  "website",
  "url",
])
const HEADING = "h1,h2,h3,h4,h5,h6,[role=heading]"

const cap = (text: string | undefined, max = AI_FIELD_TEXT_MAX) => (text ? text.slice(0, max) : undefined)
const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")
const px = (value: string) => (value.endsWith("px") ? Number.parseFloat(value) : Number.NaN)

function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

function isControlledByCombobox(listbox: HTMLElement): boolean {
  if (!listbox.id) return false
  const root = listbox.getRootNode() as Document | ShadowRoot
  for (const owner of Array.from(root.querySelectorAll("[aria-controls],[aria-owns]"))) {
    const ids = `${owner.getAttribute("aria-controls") ?? ""} ${owner.getAttribute("aria-owns") ?? ""}`.split(/\s+/)
    if (ids.includes(listbox.id)) return true
  }
  return false
}

export function kindOf(el: HTMLElement): FieldKind | null {
  const role = el.getAttribute("role")
  switch (el.localName) {
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase()
      if (NOT_FILLABLE.has(type)) return null
      if (type === "radio" || type === "checkbox" || type === "file") return type
      return role === "combobox" || el.parentElement?.closest("[role=combobox]") ? "combobox" : "text"
    }
    case "textarea":
      return "textarea"
    case "select":
      return "select"
    case "button":
      return role === "combobox" || el.getAttribute("aria-haspopup") === "listbox" ? "combobox" : null
  }
  if (role === "combobox") return el.querySelector("input:not([type=hidden]),textarea") ? null : "combobox"
  if (role === "listbox") return isControlledByCombobox(el) ? null : "combobox"
  const editable = el.getAttribute("contenteditable")
  const isRoot =
    (editable !== null && editable !== "false") || (el.localName === "body" && el.ownerDocument.designMode === "on")
  if (isRoot && !el.parentElement?.closest("[contenteditable]:not([contenteditable=false])")) return "contenteditable"
  return null
}

export function labelsFor(el: HTMLElement, ctx: Ctx): HTMLElement[] {
  const root = el.getRootNode()
  let all = ctx.labels.get(root)
  if (!all) {
    all = Array.from((root as Document).querySelectorAll<HTMLElement>("label"))
    ctx.labels.set(root, all)
  }
  const found = el.id ? all.filter((label) => label.getAttribute("for") === el.id) : []
  const wrapping = el.closest("label") as HTMLElement | null
  if (wrapping && !found.includes(wrapping)) found.push(wrapping)
  return found
}

function byId(el: HTMLElement, id: string): HTMLElement | null {
  const root = el.getRootNode() as Document | ShadowRoot
  return (root.getElementById?.(id) ?? el.ownerDocument.getElementById(id)) as HTMLElement | null
}

function precedingText(el: HTMLElement): string {
  let node: HTMLElement | null = el
  for (let depth = 0; node && depth < 3; depth++, node = parentOf(node)) {
    for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
      if (isElement(sibling)) {
        if (containsControl(sibling)) return ""
        if (!isRendered(sibling)) continue
      }
      const text = textOf(sibling)
      if (text) return text
    }
    if (node.localName === "form") break
  }
  return ""
}

function textBefore(container: HTMLElement, member: HTMLElement): string {
  let last = ""
  for (const child of Array.from(container.childNodes)) {
    if (child === member || child.contains(member)) break
    if (isElement(child) && containsControl(child)) continue
    last = textOf(child) || last
  }
  return last
}

function commonAncestor(members: HTMLElement[]): HTMLElement | null {
  let node: HTMLElement | null = parentOf(members[0] as HTMLElement)
  while (node && !members.every((member) => node?.contains(member))) node = parentOf(node)
  return node
}

function ownLabel(el: HTMLElement, ctx: Ctx): string {
  for (const label of labelsFor(el, ctx)) {
    const text = textOf(label)
    if (text) return text
  }
  const labelledBy = el.getAttribute("aria-labelledby")
  if (labelledBy) {
    const text = cleanText(
      labelledBy
        .split(/\s+/)
        .map((id) => byId(el, id))
        .map((node) => (node ? textOf(node) : ""))
        .join(" "),
    )
    if (text) return text
  }
  return cleanText(el.getAttribute("aria-label"))
}

function groupLabel(members: HTMLElement[], ctx: Ctx): string {
  const first = members[0] as HTMLElement
  const legend = first.closest("fieldset")?.querySelector(":scope > legend")
  if (legend) {
    const text = textOf(legend)
    if (text) return text
  }
  const group = first.closest("[role=radiogroup],[role=group]") as HTMLElement | null
  if (group) {
    const text = ownLabel(group, ctx)
    if (text) return text
  }
  if (members.length > 1) {
    const container = commonAncestor(members)
    if (container) return textBefore(container, first) || precedingText(container)
  }
  return ownLabel(first, ctx)
}

function sectionOf(el: HTMLElement, ctx: Ctx): string | undefined {
  let node: HTMLElement | null = parentOf(el)
  for (let depth = 0; node && depth < 6; depth++, node = parentOf(node)) {
    if (node.localName === "body" || node.localName === "form") break
    if (node.localName === "fieldset") {
      const legend = node.querySelector(":scope > legend")
      if (legend && textOf(legend)) return textOf(legend)
    }
    if (node.matches("section,[role=group],[role=region]") && node.localName !== "fieldset") {
      const text = ownLabel(node, ctx)
      if (text) return text
    }
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.matches(HEADING)) return textOf(sibling) || undefined
    }
  }
  return undefined
}

function groupMembers(el: HTMLInputElement, kind: "radio" | "checkbox"): HTMLInputElement[] {
  if (!el.name) return [el]
  const root = el.getRootNode() as Document | ShadowRoot
  const form = el.form
  return Array.from(root.querySelectorAll<HTMLInputElement>(`input[type=${kind}]`)).filter(
    (other) => other.name === el.name && other.form === form,
  )
}

function readOptions(select: HTMLSelectElement): FieldChoice[] {
  return Array.from(select.options)
    .filter(
      (option) =>
        !(option.value === "" && (option.disabled || option.index === 0 || option.textContent?.trim() === "")),
    )
    .map((option) => ({ text: cleanText(option.label || option.textContent), value: option.value, el: option }))
}

export function readListOptions(el: HTMLElement): HTMLElement[] {
  const ids = `${el.getAttribute("aria-controls") ?? ""} ${el.getAttribute("aria-owns") ?? ""}`
    .split(/\s+/)
    .filter(Boolean)
  const lists = el.getAttribute("role") === "listbox" ? [el] : ids.map((id) => byId(el, id)).filter(isElement)
  const options = lists.flatMap((list) =>
    list.matches("[role=option]") ? [list] : Array.from(list.querySelectorAll<HTMLElement>("[role=option]")),
  )
  return options.filter((option) => option.getAttribute("aria-disabled") !== "true" && isRendered(option))
}

function interactable(members: HTMLElement[], kind: FieldKind, ctx: Ctx): boolean {
  const relaxed = kind === "radio" || kind === "checkbox" || kind === "file"
  return members.some((el) => {
    if (isAriaHidden(el)) return false
    const win = view(el)
    const shown = (node: HTMLElement, strict: boolean) => {
      if (!isRendered(node)) return false
      const style = win.getComputedStyle(node)
      if (strict && style.opacity === "0") return false
      const [w, h] = [px(style.width), px(style.height)]
      if (w === 0 || h === 0) return false
      if (strict && w <= 1 && h <= 1) return false
      if (style.position === "absolute" || style.position === "fixed") {
        if (px(style.left) <= -1000 || px(style.top) <= -1000) return false
      }
      if (hasLayout(node)) {
        const rect = node.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        if (rect.right + win.scrollX <= 0 || rect.bottom + win.scrollY <= 0) return false
      }
      return true
    }
    if (shown(el, !relaxed)) return true
    if (!relaxed) return false
    if (labelsFor(el, ctx).some((label) => shown(label, false))) return true
    const parent = el.parentElement
    return kind === "file" && parent !== null && shown(parent, false)
  })
}

function buildField(
  el: HTMLElement,
  kind: FieldKind,
  ctx: Ctx,
  filter: boolean,
): { field: CollectedField | null; members: HTMLElement[] } | null {
  const input = el as HTMLInputElement
  const members: HTMLElement[] = kind === "radio" || kind === "checkbox" ? groupMembers(input, kind) : [el]
  const usable = filter ? members.filter((member) => !isDisabled(member)) : members
  if (usable.length === 0) return null
  if (
    filter &&
    kind !== "combobox" &&
    usable.some((member) => (member as HTMLInputElement).readOnly || member.getAttribute("aria-readonly") === "true")
  )
    return { field: null, members }
  if (filter && kind === "combobox" && el.getAttribute("aria-readonly") === "true") return { field: null, members }
  if (filter && !interactable(usable, kind, ctx)) return { field: null, members }

  let choices: FieldChoice[] = []
  if (kind === "select") choices = readOptions(el as HTMLSelectElement)
  else if (kind === "radio" || kind === "checkbox") {
    choices = usable.map((member) => ({
      text: ownLabel(member, ctx) || cleanText((member as HTMLInputElement).value),
      value: (member as HTMLInputElement).value,
      el: member,
    }))
  } else if (kind === "combobox") {
    choices = readListOptions(el).map((option) => ({
      text: cleanText(option.textContent),
      value: option.id,
      el: option,
    }))
  }

  const grouped = (kind === "radio" || kind === "checkbox") && usable.length > 1
  const found = kind === "radio" || grouped ? groupLabel(usable, ctx) : ownLabel(el, ctx)
  const title = cleanText(el.getAttribute("title"))
  const placeholder = cleanText(el.getAttribute("placeholder"))
  const label = found || precedingText(el) || placeholder || title
  const name = input.name || el.id || undefined
  const trapName = BAIT.has(squash(name ?? "")) || /^b_[0-9a-f]{20,}/i.test(name ?? "")
  if (filter && trapName && (el.getAttribute("tabindex") === "-1" || !label)) return { field: null, members }

  const type =
    kind === "text" ? (el.getAttribute("type") ?? "text").toLowerCase() : kind === "combobox" ? "combobox" : kind
  const required = usable.some(
    (member) => (member as HTMLInputElement).required || member.getAttribute("aria-required") === "true",
  )
  const maxLength =
    kind === "text" || kind === "textarea" ? (input.maxLength > 0 ? input.maxLength : undefined) : undefined
  const info: FieldInfo = {
    required,
    multiple: kind === "select" ? (el as HTMLSelectElement).multiple : kind === "checkbox" && grouped,
    maxLength,
    pattern: input.getAttribute?.("pattern") ?? undefined,
    autocomplete: el.getAttribute("autocomplete") ?? undefined,
    section: cap(sectionOf(el, ctx)),
  }
  const descriptor: FieldDescriptor = {
    id: "",
    label: cap(label || undefined),
    name: cap(name ?? undefined),
    ariaLabel: cap(cleanText(el.getAttribute("aria-label")) || undefined),
    placeholder: cap(placeholder || undefined),
    type,
    options: choices
      .map((choice) => cap(choice.text, AI_OPTION_TEXT_MAX))
      .filter((text): text is string => Boolean(text))
      .slice(0, AI_OPTIONS_MAX),
  }
  return { field: { id: "", kind, el: usable[0] as HTMLElement, choices, descriptor, info }, members }
}

/** The field a single control belongs to, without the visibility and trap filters. */
export function resolveField(el: HTMLElement): CollectedField | null {
  const kind = kindOf(el)
  return kind ? (buildField(el, kind, { labels: new Map() }, false)?.field ?? null) : null
}

/** Every control a person could fill on the page, in document order, with what the page says about it. */
export function collectFields(root: ParentNode = document): CollectedField[] {
  const ctx: Ctx = { labels: new Map() }
  const fields: CollectedField[] = []
  const seen = new Set<Element>()
  const used = new Map<string, number>()
  for (const el of walkElements(root)) {
    if (seen.has(el)) continue
    const kind = kindOf(el)
    if (!kind) continue
    const built = buildField(el, kind, ctx, true)
    if (!built) continue
    for (const member of built.members) seen.add(member)
    const { field } = built
    if (!field) continue
    const base = hash(
      [field.kind, field.descriptor.type, field.descriptor.name, field.descriptor.label, field.info.section].join("|"),
    )
    const count = (used.get(base) ?? 0) + 1
    used.set(base, count)
    field.id = count === 1 ? `f_${base}` : `f_${base}_${count}`
    field.descriptor.id = field.id
    fields.push(field)
  }
  return fields
}

/** Descriptors split into requests that pass the `ai.mapFields` input limits. */
export function descriptorBatches(fields: CollectedField[]): FieldDescriptor[][] {
  const size = (d: FieldDescriptor) =>
    [d.id, d.label, d.name, d.ariaLabel, d.placeholder, d.type, ...d.options].reduce(
      (sum, text) => sum + (text?.length ?? 0),
      0,
    )
  const batches: FieldDescriptor[][] = []
  let batch: FieldDescriptor[] = []
  let chars = 0
  for (const { descriptor } of fields) {
    const own = size(descriptor)
    if (batch.length > 0 && (batch.length >= AI_FIELDS_MAX || chars + own > AI_REQUEST_CHARS_MAX)) {
      batches.push(batch)
      batch = []
      chars = 0
    }
    batch.push(own > AI_REQUEST_CHARS_MAX ? { ...descriptor, options: [] } : descriptor)
    chars += own
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}
