import { CV_PATCH_BYTES_MAX, CV_PATCH_OPS_MAX, type CV_REJECTIONS } from "@skiffr/common/constants"
import { type CvChange, type CvOperation, cvOperationSchema } from "@skiffr/common/schemas"
import { CvError } from "./errors"
import { applyOps, type PatchOp } from "./json-patch"
import {
  bulletsHtml,
  type ExperienceView,
  paragraphsHtml,
  parseBullets,
  type ResumeView,
  type SkillView,
  sectionItems,
} from "./resume"
import {
  buildVocab,
  hasPhrase,
  hasUnicodeTrick,
  isPlainWord,
  newWords,
  normalize,
  squash,
  stem,
  tokens,
  type Vocab,
} from "./text"

export type Rejection = (typeof CV_REJECTIONS)[number]
export interface Rejected {
  reason: Rejection
  path: string
}

export const HEADLINE_MAX = 120
export const SUMMARY_MAX = 800
export const BULLET_MAX = 400
export const KEYWORD_MAX = 60
export const KEYWORDS_MAX = 40
/** A reworded bullet must share at least this much of its meaning-bearing words with a bullet it replaces. */
const SIMILARITY_MIN = 0.25

type ListName = "skills" | "experience"

type Target =
  | { kind: "headline" }
  | { kind: "summary" }
  | { kind: "field"; list: ListName; at: number; field: "keywords" | "hidden" | "bullets" }
  | { kind: "section"; name: string }
  | { kind: "move"; list: ListName; at: number }

const INDEX = "(0|[1-9]\\d{0,3})"

/** The allowlist. A path that matches none of these is out, whatever the operation says. */
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
    const move = new RegExp(`^/(skills|experience)/${INDEX}$`).exec(path)
    if (move) return { kind: "move", list: move[1] as ListName, at: Number(move[2]) }
  }
  return null
}

/** Everything the applicant has written, in the resume and the profile: the only place a word, a number or a skill may come from. */
export interface Source {
  vocab: Vocab
}

export const buildSource = (texts: readonly string[]): Source => ({ vocab: buildVocab(texts) })

type Checked<T> = { ok: true; value: T } | { ok: false; reason: Rejection }
const fail = (reason: Rejection): { ok: false; reason: Rejection } => ({ ok: false, reason })

function checkText(value: unknown, max: number, source: Source): Checked<string> {
  if (typeof value !== "string") return fail("invalid_value")
  if (hasUnicodeTrick(value)) return fail("unicode")
  const text = normalize(value)
    .replace(/[ \t]+/g, " ")
    .trim()
  if (!text) return fail("invalid_value")
  if (text.length > max) return fail("too_long")
  return newWords(text, source.vocab).length > 0 ? fail("invented_fact") : { ok: true, value: text }
}

function checkKeywords(value: unknown, source: Source): Checked<string[]> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return fail("invalid_value")
  if (value.length > KEYWORDS_MAX) return fail("too_long")
  const out: string[] = []
  for (const entry of value as string[]) {
    if (hasUnicodeTrick(entry)) return fail("unicode")
    const keyword = squash(entry)
    if (!keyword) return fail("invalid_value")
    if (keyword.length > KEYWORD_MAX) return fail("too_long")
    if (!hasPhrase(keyword, source.vocab)) return fail("invented_skill")
    if (!out.includes(keyword)) out.push(keyword)
  }
  return { ok: true, value: out }
}

const content = (text: string) =>
  new Set(
    tokens(text)
      .filter((word) => !isPlainWord(word))
      .map(stem),
  )

function similarity(a: string, b: string): number {
  const left = content(a)
  const right = content(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return shared / (left.size + right.size - shared)
}

/** Bullets may be reordered, dropped, or reworded from the same bullet; never added, never replaced by a different claim, and only in the words of their own entry, so a tool from one job can't move to another. */
function checkBullets(value: unknown, original: readonly string[], vocab: Vocab): Checked<string[]> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return fail("invalid_value")
  if (value.length === 0 || value.length > original.length) return fail("invalid_value")
  const next: string[] = []
  for (const entry of value as string[]) {
    if (hasUnicodeTrick(entry)) return fail("unicode")
    const bullet = squash(entry)
    if (!bullet) return fail("invalid_value")
    if (bullet.length > BULLET_MAX) return fail("too_long")
    if (next.includes(bullet)) return fail("invalid_value")
    next.push(bullet)
  }
  const free = original.filter((bullet) => !next.includes(bullet))
  for (const bullet of next) {
    if (original.includes(bullet)) continue
    if (newWords(bullet, vocab).length > 0) return fail("invented_fact")
    let best = -1
    let bestScore = 0
    free.forEach((candidate, at) => {
      const score = similarity(bullet, candidate)
      if (score > bestScore) [best, bestScore] = [at, score]
    })
    if (best < 0 || bestScore < SIMILARITY_MIN) return fail("not_a_rewording")
    free.splice(best, 1)
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

const clone = <T>(value: T): T => structuredClone(value)

/**
 * Applies a proposed patch to the view of the resume, one operation at a time, and keeps only the operations that pass.
 * Nothing is trusted: the path must be on the allowlist, the index must exist, and every string must be made of words
 * the applicant already wrote (or plain connectors), with every number copied exactly. A refused operation is dropped
 * and reported, the rest still apply. The result is then compiled to operations on the real resume.
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
      const checked = checkText(op.value, target.kind === "headline" ? HEADLINE_MAX : SUMMARY_MAX, input.source)
      if (!checked.ok) {
        refuse(checked.reason)
        continue
      }
      if (view[target.kind] !== checked.value) {
        view[target.kind] = checked.value
        accepted.push({ op: "replace", path: op.path, value: checked.value })
      }
    } else if (target.kind === "section") {
      if (typeof op.value !== "boolean") refuse("invalid_value")
      else if (!view.sections[target.name]) refuse("bad_index")
      else if (view.sections[target.name]?.hidden !== op.value) {
        view.sections[target.name] = { hidden: op.value }
        accepted.push({ op: "replace", path: op.path, value: op.value })
      }
    } else if (target.kind === "move") {
      const items = view[target.list] as Array<SkillView | ExperienceView>
      const fromTarget = op.from === undefined ? null : targetOf(op.from, "move")
      if (fromTarget?.kind !== "move" || fromTarget.list !== target.list) refuse("path_not_allowed")
      else if (fromTarget.at >= items.length || target.at >= items.length) refuse("bad_index")
      else if (fromTarget.at !== target.at) {
        const [moved] = items.splice(fromTarget.at, 1)
        items.splice(target.at, 0, moved as SkillView & ExperienceView)
        accepted.push({ op: "move", from: op.from, path: op.path })
      }
    } else {
      const items = view[target.list] as Array<SkillView | ExperienceView>
      const item = items[target.at]
      if (!item) {
        refuse("bad_index")
        continue
      }
      if (target.field === "hidden") {
        if (typeof op.value !== "boolean") refuse("invalid_value")
        else if (item.hidden !== op.value) {
          item.hidden = op.value
          accepted.push({ op: "replace", path: op.path, value: op.value })
        }
      } else if (target.field === "keywords") {
        const checked = target.list === "skills" ? checkKeywords(op.value, input.source) : fail("path_not_allowed")
        if (!checked.ok) refuse(checked.reason)
        else if (!same((item as SkillView).keywords, checked.value)) {
          ;(item as SkillView).keywords = checked.value
          accepted.push({ op: "replace", path: op.path, value: checked.value })
        }
      } else {
        const current = (item as ExperienceView).bullets
        const base = input.view.experience.find((entry) => entry.origin === (item as ExperienceView).origin)
        const checked =
          target.list === "experience" && current && base?.bullets
            ? checkBullets(op.value, current, buildVocab([...base.bullets, base.company, base.position, base.period]))
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
