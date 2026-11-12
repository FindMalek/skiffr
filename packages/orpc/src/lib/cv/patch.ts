import { CV_PATCH_BYTES_MAX, CV_PATCH_OPS_MAX, type CV_REJECTIONS } from "@skiffr/common/constants"
import { type CvChange, type CvOperation, cvOperationSchema } from "@skiffr/common/schemas"
import { CvError } from "./errors"
import { applyOps, type PatchOp } from "./json-patch"
import {
  bulletsHtml,
  type ExperienceView,
  hasSection,
  paragraphsHtml,
  parseBullets,
  type ResumeView,
  type SkillView,
  sectionItems,
} from "./resume"
import { buildScope, clauseKeys, copyOf, hasUnicodeTrick, type Scope, squash } from "./text"

export type Rejection = (typeof CV_REJECTIONS)[number]
export interface Rejected {
  reason: Rejection
  path: string
}

export const HEADLINE_MAX = 120
export const SUMMARY_MAX = 800
export const BULLET_MAX = 400
export const KEYWORDS_MAX = 40

type ListName = "skills" | "experience"

type Target =
  | { kind: "headline" }
  | { kind: "summary" }
  | { kind: "field"; list: ListName; at: number; field: "keywords" | "hidden" | "bullets" }
  | { kind: "section"; name: string }
  | { kind: "move"; at: number }

const INDEX = "(0|[1-9]\\d{0,3})"

/** The allowlist. A path that matches none of these is out, whatever the operation says. Only skill groups can be moved. */
function targetOf(path: string, op: string): Target | null {
  if (op === "replace") {
    if (path === "/headline") return { kind: "headline" }
    if (path === "/summary") return { kind: "summary" }
    const field = new RegExp(`^/(skills|experience)/${INDEX}/(keywords|hidden|bullets)$`).exec(path)
    if (field) return { kind: "field", list: field[1] as ListName, at: Number(field[2]), field: field[3] as never }
    const section = /^\/sections\/([a-z]{3,24})\/hidden$/.exec(path)
    if (section) return { kind: "section", name: section[1] as string }
  }
  if (op === "move") {
    const move = new RegExp(`^/skills/${INDEX}$`).exec(path)
    if (move) return { kind: "move", at: Number(move[1]) }
  }
  return null
}

/**
 * Where new text may come from, and nothing else does. Text is only ever rebuilt from whole clauses. The headline and
 * the summary may reuse the clauses of the existing headline and summary. A bullet may reuse the clauses of its own
 * entry's bullets. A skill group may only reorder and drop its own keywords, plus add what the profile lists as
 * skills. Hidden entries, hidden sections and custom sections are not in any of it: the applicant chose not to show them.
 */
export interface Source {
  overall: Scope
  entries: Map<number, Scope>
  skills: Map<number, Map<string, string>>
  profileSkills: Map<string, string>
}

const key = (text: string) => squash(text).toLowerCase()
const keyed = (list: readonly string[]) => new Map(list.map((entry) => [key(entry), entry] as const))

export function buildSource(view: ResumeView, profileSkills: readonly string[] = []): Source {
  const entries = new Map<number, Scope>()
  const skills = new Map<number, Map<string, string>>()
  for (const entry of view.experience) {
    if (!entry.hidden && entry.bullets) entries.set(entry.origin, buildScope(entry.bullets))
  }
  for (const group of view.skills) if (!group.hidden) skills.set(group.origin, keyed(group.keywords))
  const overall = buildScope([view.headline, ...(view.summaryHidden ? [] : [view.summary])])
  return { overall, entries, skills, profileSkills: keyed(profileSkills) }
}

type Checked<T> = { ok: true; value: T } | { ok: false; reason: Rejection }
const fail = (reason: Rejection): { ok: false; reason: Rejection } => ({ ok: false, reason })

function checkText(value: unknown, max: number, scope: Scope, shape: "line" | "paragraphs"): Checked<string> {
  if (typeof value !== "string") return fail("invalid_value")
  if (hasUnicodeTrick(value)) return fail("unicode")
  if (!squash(value)) return fail("invalid_value")
  if (value.length > max * 2) return fail("too_long")
  const text = copyOf(value, scope, shape)
  if (text === null) return fail("invented_fact")
  return text.length > max ? fail("too_long") : { ok: true, value: text }
}

/** Keywords are stored as the applicant wrote them, so a symbol or a change of case can't come in with them. */
function checkKeywords(value: unknown, own: Map<string, string>, profile: Map<string, string>): Checked<string[]> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return fail("invalid_value")
  if (value.length > KEYWORDS_MAX) return fail("too_long")
  const out: string[] = []
  for (const entry of value as string[]) {
    if (hasUnicodeTrick(entry)) return fail("unicode")
    const known = own.get(key(entry)) ?? profile.get(key(entry))
    if (known === undefined) return fail("invented_skill")
    if (!out.some((kept) => key(kept) === key(known))) out.push(known)
  }
  return { ok: true, value: out }
}

/** Bullets may be reordered, dropped or rebuilt from whole clauses of the entry's own bullets. Never added, and never in other words. */
function checkBullets(value: unknown, original: readonly string[], scope: Scope): Checked<string[]> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return fail("invalid_value")
  if (value.length === 0 || value.length > original.length) return fail("invalid_value")
  const next: string[] = []
  for (const entry of value as string[]) {
    if (hasUnicodeTrick(entry)) return fail("unicode")
    const asked = squash(entry)
    if (!asked) return fail("invalid_value")
    if (asked.length > BULLET_MAX) return fail("too_long")
    const bullet = original.includes(asked) ? asked : copyOf(asked, scope, "line")
    if (bullet === null) return fail("invented_fact")
    if (next.includes(bullet)) return fail("invalid_value")
    next.push(bullet)
  }
  return { ok: true, value: next }
}

const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i])

export interface Evaluation {
  /** The operations that passed, in order, ready to be sent back and checked again. */
  operations: CvOperation[]
  rejected: Rejected[]
  view: ResumeView
  /** The same changes as operations on the real resume (`replace` and `move` only). */
  resumeOps: PatchOp[]
  changes: CvChange[]
}

export function patchTooLarge(ops: readonly unknown[]): boolean {
  return ops.length > CV_PATCH_OPS_MAX || JSON.stringify(ops).length > CV_PATCH_BYTES_MAX
}

/** What a model proposed, cut to what a patch may hold: extra operations are dropped, not an error. */
export function fitPatch<T>(ops: readonly T[]): T[] {
  const kept = ops.slice(0, CV_PATCH_OPS_MAX)
  while (kept.length > 0 && JSON.stringify(kept).length > CV_PATCH_BYTES_MAX) kept.pop()
  return kept
}

const clone = <T>(value: T): T => structuredClone(value)

/**
 * Applies a proposed patch to the view of the resume, one operation at a time, and keeps only the operations that pass.
 * Nothing is trusted: the path must be on the allowlist, the index must exist, `hidden` can only be set to true, and
 * every text must be copied from the applicant's own visible words (see `Source`). A refused operation is dropped and
 * reported, the rest still apply. The result is then compiled to operations on the real resume.
 */
export function evaluatePatch(input: {
  data: Record<string, unknown>
  view: ResumeView
  operations: readonly unknown[]
  source: Source
}): Evaluation {
  if (patchTooLarge(input.operations)) throw new CvError("bad_request")
  const view = clone(input.view)
  const accepted: CvOperation[] = []
  const rejected: Rejected[] = []
  const { source } = input

  for (const raw of input.operations) {
    const parsed = cvOperationSchema.safeParse(raw)
    const path = parsed.success ? parsed.data.path.slice(0, 120) : ""
    const refuse = (reason: Rejection) => void rejected.push({ reason, path })
    if (!parsed.success) {
      refuse("invalid_value")
      continue
    }
    const op = parsed.data
    if (op.op !== "replace" && op.op !== "move") {
      refuse("op_not_allowed")
      continue
    }
    const target = targetOf(op.path, op.op)
    if (!target) {
      refuse("path_not_allowed")
      continue
    }

    if (target.kind === "headline" || target.kind === "summary") {
      if (target.kind === "summary" && view.summaryHidden) {
        refuse("path_not_allowed")
        continue
      }
      const headline = target.kind === "headline"
      const checked = checkText(
        headline && typeof op.value === "string" ? squash(op.value) : op.value,
        headline ? HEADLINE_MAX : SUMMARY_MAX,
        source.overall,
        headline ? "line" : "paragraphs",
      )
      if (!checked.ok) {
        refuse(checked.reason)
        continue
      }
      const unchanged = clauseKeys(checked.value).join("|") === clauseKeys(view[target.kind]).join("|")
      if (!unchanged) {
        view[target.kind] = checked.value
        accepted.push({ op: "replace", path: op.path, value: checked.value })
      }
    } else if (target.kind === "section") {
      if (op.value !== true) refuse("hide_only")
      else if (!hasSection(view, target.name)) refuse("bad_index")
      else if (view.sections[target.name]?.hidden !== true) {
        view.sections[target.name] = { hidden: true }
        accepted.push({ op: "replace", path: op.path, value: true })
      }
    } else if (target.kind === "move") {
      const fromTarget = op.from === undefined ? null : targetOf(op.from, "move")
      if (fromTarget?.kind !== "move") refuse("path_not_allowed")
      else if (fromTarget.at >= view.skills.length || target.at >= view.skills.length) refuse("bad_index")
      else if (fromTarget.at !== target.at) {
        const [moved] = view.skills.splice(fromTarget.at, 1)
        view.skills.splice(target.at, 0, moved as SkillView)
        accepted.push({ op: "move", from: op.from, path: op.path })
      }
    } else {
      const items = view[target.list] as Array<SkillView | ExperienceView>
      const item = items[target.at]
      if (!item) {
        refuse("bad_index")
        continue
      }
      const base = (target.list === "skills" ? input.view.skills : input.view.experience).find(
        (entry) => entry.origin === item.origin,
      ) as SkillView | ExperienceView
      if (target.field === "hidden") {
        if (op.value !== true) refuse("hide_only")
        else if (!item.hidden) {
          item.hidden = true
          accepted.push({ op: "replace", path: op.path, value: true })
        }
      } else if (base.hidden) {
        refuse("path_not_allowed")
      } else if (target.field === "keywords") {
        const own = source.skills.get(item.origin)
        const checked =
          target.list === "skills" && own
            ? checkKeywords(op.value, own, source.profileSkills)
            : fail("path_not_allowed")
        if (!checked.ok) refuse(checked.reason)
        else if (!same((item as SkillView).keywords, checked.value)) {
          ;(item as SkillView).keywords = checked.value
          accepted.push({ op: "replace", path: op.path, value: checked.value })
        }
      } else {
        const current = (item as ExperienceView).bullets
        const scope = source.entries.get(item.origin)
        const checked =
          target.list === "experience" && current && scope && (base as ExperienceView).bullets
            ? checkBullets(op.value, (base as ExperienceView).bullets as string[], scope)
            : fail("path_not_allowed")
        if (!checked.ok) refuse(checked.reason)
        else if (!same(current as string[], checked.value)) {
          ;(item as ExperienceView).bullets = checked.value
          accepted.push({ op: "replace", path: op.path, value: checked.value })
        }
      }
    }
  }

  const { resumeOps, changes } = compile(input.data, input.view, view)
  return { operations: accepted, rejected, view, resumeOps, changes }
}

const ALLOWED_RESUME_PATHS = [
  /^\/basics\/headline$/,
  /^\/summary\/content$/,
  /^\/sections\/[a-z]{3,24}\/hidden$/,
  /^\/sections\/(?:skills|experience)\/items\/(?:0|[1-9]\d{0,3})\/(?:keywords|hidden|description)$/,
  /^\/sections\/(?:skills|experience)\/items\/(?:0|[1-9]\d{0,3})$/,
]

/** The last gate before anything is sent to Reactive Resume: only replace and move, only these paths. */
export function assertResumeOps(ops: readonly PatchOp[]): void {
  for (const op of ops) {
    if (op.op !== "replace" && op.op !== "move") throw new CvError("bad_request")
    if (!ALLOWED_RESUME_PATHS.some((allowed) => allowed.test(op.path))) throw new CvError("bad_request")
    if (op.op === "move" && !(op.from && ALLOWED_RESUME_PATHS[4]?.test(op.from))) throw new CvError("bad_request")
  }
  if (patchTooLarge(ops)) throw new CvError("bad_request")
}

function compile(data: Record<string, unknown>, before: ResumeView, after: ResumeView) {
  const ops: PatchOp[] = []
  const changes: CvChange[] = []
  const replace = (path: string, value: unknown) => void ops.push({ op: "replace", path, value })

  if (after.headline !== before.headline) {
    replace("/basics/headline", after.headline)
    changes.push({
      id: "headline",
      kind: "text",
      label: "Headline",
      before: [before.headline],
      after: [after.headline],
    })
  }
  if (after.summary !== before.summary) {
    replace("/summary/content", paragraphsHtml(after.summary))
    changes.push({ id: "summary", kind: "text", label: "Summary", before: [before.summary], after: [after.summary] })
  }
  for (const [name, section] of Object.entries(after.sections)) {
    if (section.hidden === before.sections[name]?.hidden) continue
    replace(`/sections/${name}/hidden`, section.hidden)
    changes.push({
      id: `section.${name}`,
      kind: "flag",
      label: `Section: ${name}`,
      before: [before.sections[name]?.hidden ? "Hidden" : "Shown"],
      after: [section.hidden ? "Hidden" : "Shown"],
    })
  }

  const original = (list: ListName, origin: number) => before[list].find((item) => item.origin === origin)
  const itemsPath = (list: ListName, origin: number) => `/sections/${list}/items/${origin}`
  for (const item of after.skills) {
    const was = original("skills", item.origin) as SkillView
    const label = `Skills: ${item.name || "group"}`
    if (!same(item.keywords, was.keywords)) {
      replace(`${itemsPath("skills", item.origin)}/keywords`, item.keywords)
      changes.push({
        id: `skills.${item.origin}.keywords`,
        kind: "list",
        label,
        before: was.keywords,
        after: item.keywords,
      })
    }
    if (item.hidden !== was.hidden) {
      replace(`${itemsPath("skills", item.origin)}/hidden`, item.hidden)
      changes.push(flag(`skills.${item.origin}.hidden`, label, was.hidden, item.hidden))
    }
  }
  for (const item of after.experience) {
    const was = original("experience", item.origin) as ExperienceView
    const label = `${item.company || "Experience"}${item.position ? `, ${item.position}` : ""}`
    if (item.bullets && was.bullets && !same(item.bullets, was.bullets)) {
      const html = sectionItems(data, "experience")[item.origin]?.description
      const parsed = typeof html === "string" ? parseBullets(html) : null
      if (parsed) {
        replace(`${itemsPath("experience", item.origin)}/description`, bulletsHtml(parsed, item.bullets))
        changes.push({
          id: `experience.${item.origin}.bullets`,
          kind: "list",
          label,
          before: was.bullets,
          after: item.bullets,
        })
      }
    }
    if (item.hidden !== was.hidden) {
      replace(`${itemsPath("experience", item.origin)}/hidden`, item.hidden)
      changes.push(flag(`experience.${item.origin}.hidden`, label, was.hidden, item.hidden))
    }
  }

  for (const list of ["skills", "experience"] as const) {
    const order = after[list].map((item) => item.origin)
    const names = (origins: readonly number[]) => origins.map((o) => nameOf(original(list, o)))
    if (
      same(
        order,
        before[list].map((item) => item.origin),
      )
    )
      continue
    const current = before[list].map((item) => item.origin)
    order.forEach((origin, to) => {
      const from = current.indexOf(origin)
      if (from === to) return
      current.splice(from, 1)
      current.splice(to, 0, origin)
      ops.push({ op: "move", from: `${itemsPath(list, from)}`, path: `${itemsPath(list, to)}` })
    })
    changes.push({
      id: `${list}.order`,
      kind: "order",
      label: list === "skills" ? "Skills order" : "Experience order",
      before: names(before[list].map((item) => item.origin)),
      after: names(order),
    })
  }
  return { resumeOps: ops, changes }
}

const nameOf = (item: SkillView | ExperienceView | undefined): string =>
  item ? ("name" in item ? item.name : [item.company, item.position].filter(Boolean).join(", ")) || "(untitled)" : ""

const flag = (id: string, label: string, was: boolean, now: boolean): CvChange => ({
  id,
  kind: "flag",
  label,
  before: [was ? "Hidden" : "Shown"],
  after: [now ? "Hidden" : "Shown"],
})

/** The resume with the patch applied, in memory. */
export function patched(data: Record<string, unknown>, ops: readonly PatchOp[]): Record<string, unknown> {
  assertResumeOps(ops)
  try {
    return applyOps(data, ops)
  } catch {
    throw new CvError("bad_request")
  }
}
