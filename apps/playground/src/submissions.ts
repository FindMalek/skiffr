import { randomUUID } from "node:crypto"
import { clean } from "./html.ts"
import { isSecret, isSensitive } from "./sensitive.ts"

export interface Summary {
  id: string
  name: string
  label: string
  type: string
  required: boolean
  disabled: boolean
  visible: boolean
  /** A field no person sees or fills: the page marks it, so touching it means autofill reached something hidden. */
  trap: boolean
  value: string
}

export type FieldFlag = "sensitive-touched" | "trap-touched" | "required-empty" | null

export interface AnalysedField extends Summary {
  filled: boolean
  sensitive: boolean
  flag: FieldFlag
}

export interface Submission {
  id: string
  at: string
  site: string
  run: string
  variant: string | null
  layout: string
  cookie: boolean
  latency: number
  host: string
  fields: AnalysedField[]
  posted: { name: string; value: string }[]
  counts: { filled: number; empty: number; requiredEmpty: number; sensitiveTouched: number; trapTouched: number }
}

export interface SubmissionMeta {
  site: string
  run: string
  variant: string | null
  layout: string
  cookie: boolean
  latency: number
  host: string
}

const MAX_FIELDS = 300
const MAX_POSTED = 300

function asSummary(raw: unknown): Summary | null {
  if (typeof raw !== "object" || raw === null) return null
  const item = raw as Record<string, unknown>
  const type = clean(item.type, 30)
  const name = clean(item.name, 120)
  const value = isSecret(name, type) && item.value ? "[hidden]" : clean(item.value, 300)
  return {
    id: clean(item.id, 120),
    name,
    label: clean(item.label, 200),
    type,
    required: item.required === true,
    disabled: item.disabled === true,
    visible: item.visible !== false,
    trap: item.trap === true,
    value,
  }
}

/** Everything a page reports is data from a visitor: it is cut down to plain bounded text before it is kept. */
export function parseSummaries(json: string | null): Summary[] {
  if (!json) return []
  try {
    const list: unknown = JSON.parse(json)
    if (!Array.isArray(list)) return []
    return list.slice(0, MAX_FIELDS).flatMap((raw) => asSummary(raw) ?? [])
  } catch {
    return []
  }
}

export function analyse(fields: Summary[]): AnalysedField[] {
  return fields.map((field) => {
    const filled = field.value !== ""
    const sensitive = isSensitive(field.label, field.name)
    const trapTouched = filled && field.trap
    let flag: FieldFlag = null
    if (sensitive && filled) flag = "sensitive-touched"
    else if (trapTouched) flag = "trap-touched"
    else if (field.required && field.visible && !field.disabled && !filled) flag = "required-empty"
    return { ...field, filled, sensitive, flag }
  })
}

export async function readPosted(form: FormData): Promise<{ posted: Submission["posted"]; summary: string | null }> {
  const posted: Submission["posted"] = []
  let summary: string | null = null
  for (const [name, entry] of form.entries()) {
    const value = entry as string | File
    if (name === "__pg_fields") {
      summary = typeof value === "string" ? value : null
      continue
    }
    if (posted.length >= MAX_POSTED) break
    const text =
      typeof value === "string" ? value : value.size > 0 ? `[file ${clean(value.name, 80)}, ${value.size} bytes]` : ""
    posted.push({ name: clean(name, 120), value: isSecret(name, "") && text ? "[hidden]" : clean(text, 300) })
  }
  return { posted, summary }
}

export function buildSubmission(meta: SubmissionMeta, summaries: Summary[], posted: Submission["posted"]): Submission {
  const fields = analyse(summaries)
  const count = (flag: FieldFlag) => fields.filter((field) => field.flag === flag).length
  const filled = fields.filter((field) => field.filled).length
  return {
    id: randomUUID().slice(0, 8),
    at: new Date().toISOString(),
    ...meta,
    host: clean(meta.host, 100),
    fields,
    posted,
    counts: {
      filled,
      empty: fields.length - filled,
      requiredEmpty: count("required-empty"),
      sensitiveTouched: count("sensitive-touched"),
      trapTouched: count("trap-touched"),
    },
  }
}

export class SubmissionStore {
  #items: Submission[] = []
  readonly max: number

  constructor(max = 100) {
    this.max = max
  }

  add(submission: Submission): void {
    this.#items.unshift(submission)
    if (this.#items.length > this.max) this.#items.length = this.max
  }

  list(filter: { run?: string; site?: string } = {}): Submission[] {
    return this.#items.filter(
      (item) => (!filter.run || item.run === filter.run) && (!filter.site || item.site === filter.site),
    )
  }

  clear(run?: string): void {
    this.#items = run ? this.#items.filter((item) => item.run !== run) : []
  }
}

export const isRed = (submission: Submission): boolean =>
  submission.counts.sensitiveTouched > 0 || submission.counts.trapTouched > 0
