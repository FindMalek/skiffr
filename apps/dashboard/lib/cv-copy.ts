import type { CvChange } from "@skiffr/common/schemas"

const REJECTIONS: Record<string, string> = {
  invented_fact: "wrote something that is not copied from your resume",
  invented_skill: "added a skill you have not listed",
  path_not_allowed: "touched a part of the resume that is never edited",
  op_not_allowed: "used an edit that is not allowed",
  bad_index: "pointed at something that does not exist",
  invalid_value: "was not a valid edit",
  hide_only: "tried to show something that is hidden (a copy can only hide)",
  unicode: "used hidden or look-alike characters",
  too_long: "was too long",
}

const REASONS = Object.keys(REJECTIONS)

/** What was dropped, as a sentence per reason with a count. Only the fixed codes are looked up, never an inherited property. */
export function rejectedSummary(rejected: ReadonlyArray<{ reason: string }>): string[] {
  const counts = new Map<string, number>()
  for (const { reason } of rejected) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  return REASONS.filter((reason) => counts.has(reason)).map((reason) => {
    const n = counts.get(reason) as number
    return `${n} ${n === 1 ? "suggestion" : "suggestions"} ${REJECTIONS[reason]}`
  })
}

export type Piece = { type: "same" | "add" | "del"; text: string }

const WORDS = /\s+|[^\s]+/g

/** A word level diff, so a reworded sentence shows what changed in it and not just that it did. */
export function diffWords(before: string, after: string): Piece[] {
  const a = before.match(WORDS) ?? []
  const b = after.match(WORDS) ?? []
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const out: Piece[] = []
  const push = (type: Piece["type"], text: string) => {
    const last = out.at(-1)
    if (last?.type === type) last.text += text
    else out.push({ type, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i] as string)
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) push("del", a[i++] as string)
    else push("add", b[j++] as string)
  }
  while (i < a.length) push("del", a[i++] as string)
  while (j < b.length) push("add", b[j++] as string)
  return out
}

/** For a list change: lines that are gone on the left, lines that are new, and lines that only moved, on the right. */
export function diffLines(change: Pick<CvChange, "before" | "after">) {
  return {
    before: change.before.map((text) => ({ text, kept: change.after.includes(text), moved: false })),
    after: change.after.map((text, index) => ({
      text,
      kept: change.before.includes(text),
      moved: change.before.includes(text) && change.before[index] !== text,
    })),
  }
}

/** The same lines in another order: nothing was added or dropped. */
export const reorderedOnly = (change: Pick<CvChange, "before" | "after">): boolean =>
  change.before.length === change.after.length &&
  [...change.before].sort().join("\n") === [...change.after].sort().join("\n")

export const scoreChange = (before: number, after: number): string =>
  after === before ? "no change" : `${after > before ? "+" : ""}${after - before} points`
