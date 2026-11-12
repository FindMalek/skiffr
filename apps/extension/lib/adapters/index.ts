import { type AtsId, matchAts } from "../detect/ats"
import type { CollectedField, FieldKind, FillResult } from "../fill/types"
import { createAshbyAdapter } from "./ashby"
import { createGreenhouseAdapter } from "./greenhouse"
import { createLeverAdapter } from "./lever"
import type { Adapter } from "./types"
import { createWorkableAdapter } from "./workable"

export type { Adapter } from "./types"

const KINDS: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "combobox",
  "contenteditable",
])
const CHOICES_MAX = 50

const LOADERS: Partial<Record<AtsId, () => Adapter>> = {
  greenhouse: () => createGreenhouseAdapter(),
  lever: () => createLeverAdapter(),
  ashby: () => createAshbyAdapter(),
  workable: () => createWorkableAdapter(),
}

const built = new Map<AtsId, Adapter>()
const byDocument = new WeakMap<Document, { href: string; adapter: Adapter | null }>()

/** Anything an adapter does is optional: a throw is the same as saying nothing. */
function guard<T>(run: () => T): T | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}

/** The adapter of the board a document is on, found from its address as the detection does. Built on first use. */
export function adapterFor(node: Node | null | undefined): Adapter | null {
  const doc = node && node.nodeType === 9 ? (node as Document) : (node?.ownerDocument ?? null)
  const href = guard(() => doc?.location?.href)
  if (!doc || !href) return null
  const known = byDocument.get(doc)
  if (known?.href === href) return known.adapter
  const id = matchAts(href)
  const load = id ? LOADERS[id] : undefined
  let adapter: Adapter | null = null
  if (id && load) {
    adapter = built.get(id) ?? guard(load) ?? null
    if (adapter) built.set(id, adapter)
  }
  byDocument.set(doc, { href, adapter })
  return adapter
}

export const adapterScope = (adapter: Adapter | null, doc: Document): Element | null =>
  (adapter && guard(() => adapter.scope?.(doc))) || null

export const adapterSkips = (adapter: Adapter | null, el: HTMLElement): boolean =>
  adapter !== null && guard(() => adapter.skip?.(el)) === true

export const adapterLabel = (adapter: Adapter | null, el: HTMLElement): string | undefined =>
  (adapter && guard(() => adapter.fieldLabel?.(el))) || undefined

export function adapterKind(adapter: Adapter | null, el: HTMLElement): FieldKind | undefined {
  const kind = adapter && guard(() => adapter.fieldKind?.(el))
  return kind && KINDS.has(kind) ? kind : undefined
}

export function adapterChoices(adapter: Adapter | null, el: HTMLElement): HTMLElement[] | undefined {
  const choices = adapter && guard(() => adapter.fieldChoices?.(el))
  return choices?.slice(0, CHOICES_MAX).filter((choice) => el.contains(choice))
}

/** An empty string is an answer (nothing chosen yet), not "no opinion". */
export const adapterRead = (adapter: Adapter | null, el: HTMLElement): string | undefined =>
  adapter ? guard(() => adapter.readValue?.(el)) : undefined

export async function adapterFill(
  adapter: Adapter | null,
  field: CollectedField,
  value: string,
): Promise<FillResult | undefined> {
  if (!adapter?.fill || field.kind === "file") return undefined
  try {
    return await adapter.fill(field, value)
  } catch {
    return undefined
  }
}
