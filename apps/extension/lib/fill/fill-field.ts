import { normalizeLabel } from "@skiffr/common"
import { labelsFor, readListOptions, resolveField } from "./collect"
import { toHintedDate, toNativeDate } from "./dates"
import {
  blurEl,
  cleanText,
  click,
  fire,
  fireChange,
  fireInput,
  fireKey,
  focusEl,
  isDisabled,
  isRendered,
  setNativeValue,
  settle,
  view,
  waitFor,
} from "./dom"
import { isFalsy, isTruthy, matchOption, sameValue, splitList } from "./match"
import { readField } from "./read"
import type { CollectedField, FillResult } from "./types"

export type FillValue = string | string[] | File
export type FillFieldOptions = { locale?: string }

const filled = (field: CollectedField, reason?: string): FillResult => ({
  status: "filled",
  reason,
  value: readField(field),
})
const failed = (field: CollectedField | null, reason: string): FillResult => ({
  status: "failed",
  reason,
  value: field ? readField(field) : undefined,
})
const skipped = (reason: string): FillResult => ({ status: "skipped", reason })

async function typeInto(el: HTMLElement, text: string): Promise<void> {
  focusEl(el)
  const input = el as HTMLInputElement
  setNativeValue(el, "")
  fireInput(el, null, "deleteContentBackward")
  for (const char of text) {
    fireKey(el, "keydown", char)
    fire(el, "beforeinput", { data: char, inputType: "insertText" }, "InputEvent")
    setNativeValue(el, input.value + char)
    try {
      input.setSelectionRange(input.value.length, input.value.length)
    } catch {}
    fireInput(el, char)
    fireKey(el, "keyup", char)
  }
}

function adaptText(
  field: CollectedField,
  text: string,
  locale?: string,
): { value: string; cut: boolean } | { error: string } {
  const { type = "text", placeholder } = field.descriptor
  let value = text.trim()
  if (field.kind === "text") {
    if (type === "number") {
      const digits = value.replace(/[^\d.-]/g, "")
      if (!/^-?\d+(\.\d+)?$/.test(digits)) return { error: "value is not a number" }
      value = digits
    } else if (type === "date" || type === "month" || type === "time" || type === "datetime-local") {
      const native = toNativeDate(type, value, locale)
      if (!native) return { error: "value is not a date this input accepts" }
      value = native
    } else if (type === "tel") {
      const max = field.info.maxLength
      const digits = value.replace(/[^\d+]/g, "")
      if (max && value.length > max) value = digits.length > max ? digits.replace(/\D/g, "").slice(-max) : digits
    } else if (placeholder) {
      value = toHintedDate(value, placeholder, locale) ?? value
    }
  }
  const max = field.info.maxLength
  const cut = Boolean(max && value.length > max)
  return { value: cut && max ? value.slice(0, max) : value, cut }
}

async function fillText(field: CollectedField, text: string, options: FillFieldOptions): Promise<FillResult> {
  const el = field.el as HTMLInputElement
  const adapted = adaptText(field, text, options.locale ?? el.ownerDocument.documentElement.lang)
  if ("error" in adapted) return failed(field, adapted.error)
  const wanted = adapted.value
  if (sameValue(el.value, wanted)) return { status: "unchanged", value: el.value }

  const commit = () => {
    fireChange(el)
    blurEl(el)
  }
  focusEl(el)
  setNativeValue(el, wanted)
  fireInput(el, wanted, "insertReplacementText")
  commit()
  await settle()
  if (!sameValue(el.value, wanted)) {
    await typeInto(el, wanted)
    commit()
    await settle()
  }
  if (!sameValue(el.value, wanted)) return failed(field, "the page did not keep the value")
  return filled(field, adapted.cut ? "cut to the field's max length" : undefined)
}

async function fillSelect(field: CollectedField, text: string): Promise<FillResult> {
  const select = field.el as HTMLSelectElement
  const wanted = select.multiple ? splitList(text) : [text]
  const picks = wanted.map((item) => matchOption(item, field.choices))
  const chosen = picks.flatMap((pick) => (pick ? [field.choices[pick.index]] : []))
  if (chosen.length === 0) return failed(field, `no option matches "${text.slice(0, 60)}"`)
  const options = chosen.map((choice) => choice?.el as HTMLOptionElement)
  const now = Array.from(select.selectedOptions)
  if (options.length === now.length && options.every((option) => now.includes(option)))
    return { status: "unchanged", value: readField(field) }

  focusEl(select)
  if (select.multiple) {
    for (const option of Array.from(select.options)) option.selected = options.includes(option)
  } else {
    setNativeValue(select, (options[0] as HTMLOptionElement).value)
    ;(options[0] as HTMLOptionElement).selected = true
  }
  fireInput(select, null, "insertReplacementText")
  fireChange(select)
  blurEl(select)
  await settle()
  if (!options.every((option) => option.selected)) return failed(field, "the page reset the selection")
  return filled(field, picks.includes(null) ? "some values had no matching option" : undefined)
}

async function press(input: HTMLInputElement, checked: boolean): Promise<boolean> {
  if (input.checked === checked) return true
  focusEl(input)
  input.click()
  await settle()
  if (input.checked !== checked) {
    labelsFor(input, { labels: new Map() })[0]?.click()
    await settle()
  }
  return input.checked === checked
}

async function fillChoices(field: CollectedField, text: string): Promise<FillResult> {
  const inputs = field.choices.map((choice) => choice.el as HTMLInputElement)
  if (field.kind === "checkbox" && inputs.length === 1) {
    const box = inputs[0] as HTMLInputElement
    const want = isTruthy(text) ? true : isFalsy(text) ? false : null
    if (want === null) return failed(field, "value is not a yes or no")
    if (box.checked === want) return { status: "unchanged", value: readField(field) }
    return (await press(box, want)) ? filled(field) : failed(field, "the page did not keep the click")
  }
  const wanted = field.kind === "checkbox" ? splitList(text) : [text]
  const picks = wanted.flatMap((item) => {
    const hit = matchOption(item, field.choices)
    return hit ? [inputs[hit.index] as HTMLInputElement] : []
  })
  if (picks.length === 0) return failed(field, `no option matches "${text.slice(0, 60)}"`)
  if (picks.every((input) => input.checked)) return { status: "unchanged", value: readField(field) }
  for (const input of picks) if (!(await press(input, true))) return failed(field, "the page did not keep the click")
  return filled(field, picks.length < wanted.length ? "some values had no matching option" : undefined)
}

function acceptsFile(input: HTMLInputElement, file: File): boolean {
  const tokens = (input.getAttribute("accept") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
  if (tokens.length === 0) return true
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()
  return tokens.some((token) =>
    token.startsWith(".")
      ? name.endsWith(token)
      : token.endsWith("/*")
        ? mime.startsWith(token.slice(0, -1))
        : mime === token,
  )
}

async function fillFile(field: CollectedField, file: File): Promise<FillResult> {
  const input = field.el as HTMLInputElement
  if (!acceptsFile(input, file)) return failed(field, "the input does not accept this file type")
  if (input.files?.length === 1 && input.files[0]?.name === file.name) return { status: "unchanged", value: file.name }
  const transfer = new (view(input).DataTransfer)()
  transfer.items.add(file)
  input.files = transfer.files
  fireInput(input, null, "insertReplacementText")
  fireChange(input)
  await settle()
  return input.files?.[0]?.name === file.name ? filled(field) : failed(field, "the page cleared the file")
}

async function fillEditable(field: CollectedField, text: string): Promise<FillResult> {
  const el = field.el
  if (sameValue(readField(field), text)) return { status: "unchanged", value: readField(field) }
  const doc = el.ownerDocument
  focusEl(el)
  try {
    view(el).getSelection()?.selectAllChildren(el)
  } catch {}
  let wrote = false
  try {
    wrote = typeof doc.execCommand === "function" && doc.execCommand("insertText", false, text)
  } catch {}
  if (!wrote || !sameValue(readField(field), text)) {
    el.textContent = text
    fireInput(el, text, "insertReplacementText")
  }
  blurEl(el)
  await settle()
  return sameValue(readField(field), text) ? filled(field) : failed(field, "the editor did not keep the text")
}

const optionTexts = (options: HTMLElement[]) => options.map((option) => ({ text: cleanText(option.textContent) }))

async function fillCombobox(field: CollectedField, text: string): Promise<FillResult> {
  const el = field.el
  const isList = el.getAttribute("role") === "listbox"
  const isInput = el.localName === "input" || el.localName === "textarea"
  const current = readField(field)
  if (current && (matchOption(text, [{ text: current }])?.score ?? 0) >= 0.9)
    return { status: "unchanged", value: current }

  const options = () => {
    const own = readListOptions(el)
    return own.length > 0 || isList ? own : portalOptions(el)
  }
  const find = () => matchOption(text, optionTexts(options()))
  if (!isList) {
    focusEl(el)
    click(el)
    if (!(await waitFor(() => options().length > 0, 350))) {
      fireKey(el, "keydown", "ArrowDown")
      await waitFor(() => options().length > 0, 350)
    }
  }
  let pick = find()
  let typed = false
  if (!pick && isInput) {
    typed = true
    await typeInto(el, text)
    await waitFor(() => find() !== null, 900)
    pick = find()
  }
  if (!pick) {
    if (typed) {
      setNativeValue(el, "")
      fireInput(el, null, "deleteContentBackward")
    }
    closeList(el, isList)
    return failed(field, `no option matches "${text.slice(0, 60)}"`)
  }
  const option = options()[pick.index] as HTMLElement
  const optionText = cleanText(option.textContent)
  click(option)
  await settle(30)
  closeList(el, isList)
  await settle()
  const shown = readField(field)
  const stuck =
    normalizeLabel(shown).includes(normalizeLabel(optionText)) ||
    (option.isConnected &&
      (option.getAttribute("aria-selected") === "true" || option.getAttribute("aria-checked") === "true"))
  return stuck ? filled(field) : failed(field, "the selection did not stick")
}

function portalOptions(el: HTMLElement): HTMLElement[] {
  return Array.from(el.ownerDocument.querySelectorAll<HTMLElement>("[role=option]")).filter(
    (option) => option.getAttribute("aria-disabled") !== "true" && isRendered(option),
  )
}

function closeList(el: HTMLElement, isList: boolean): void {
  if (isList) return
  if (el.getAttribute("aria-expanded") === "true") fireKey(el, "keydown", "Escape")
  blurEl(el)
}

/** Sets one control the way a person would, then reads it back and says whether the value stuck. */
export async function fillCollected(
  field: CollectedField,
  value: FillValue,
  options: FillFieldOptions = {},
): Promise<FillResult> {
  try {
    if (isDisabled(field.el)) return skipped("field is disabled")
    if (field.kind === "file") {
      return typeof value === "object" && !Array.isArray(value)
        ? await fillFile(field, value)
        : skipped("files are only set from an explicit file")
    }
    if (typeof value === "object" && !Array.isArray(value)) return skipped("a file can only go into a file input")
    const text = Array.isArray(value) ? value.join(", ") : value
    if (!text.trim()) return skipped("empty value")
    if (field.kind !== "combobox" && (field.el as HTMLInputElement).readOnly) return skipped("field is read only")
    switch (field.kind) {
      case "select":
        return await fillSelect(field, text)
      case "radio":
      case "checkbox":
        return await fillChoices(field, text)
      case "contenteditable":
        return await fillEditable(field, text)
      case "combobox":
        return await fillCombobox(field, text)
      default:
        return await fillText(field, text, options)
    }
  } catch (error) {
    return failed(field, error instanceof Error ? error.message : "unexpected error")
  }
}

export async function fillField(
  el: HTMLElement,
  value: FillValue,
  options: FillFieldOptions = {},
): Promise<FillResult> {
  const field = resolveField(el)
  return field ? fillCollected(field, value, options) : skipped("not a fillable control")
}
