import { expect, test } from "bun:test"
import type { Job, JobCounts } from "@skiffr/common/schemas"
import {
  applyToCounts,
  applyToList,
  DEFAULT_FILTERS,
  type Intent,
  listInput,
  pruneList,
  revertCounts,
  revertList,
  sourceLabel,
} from "./queue"

const job = (n: number, extra: Partial<Job> = {}): Job => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  url: `https://jobs.acme.dev/${n}`,
  canonicalId: `acme:${n}`,
  title: `Role ${n}`,
  company: "Acme",
  source: "manual",
  status: "queued",
  queuedAt: new Date(Date.UTC(2026, 10, 10, 10, n)),
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...extra,
})

const counts: JobCounts = {
  status: { queued: 3, applied: 1, skipped: 0 },
  sources: [
    { source: "manual", count: 3 },
    { source: "gmail", count: 1 },
  ],
}

test("the queue is read oldest first with one spare row, other views newest first, empty filters left out", () => {
  expect(listInput(DEFAULT_FILTERS, 50)).toEqual({ limit: 51, status: "queued", order: "oldest" })
  expect(listInput({ status: "all", source: "gmail", q: "  acme " }, 100)).toEqual({
    limit: 101,
    source: "gmail",
    q: "acme",
    order: "newest",
  })
  expect(listInput({ status: "skipped", source: "", q: "" }, 9999).limit).toBe(401)
})

test("a skipped row keeps its place until the server confirms, then leaves the queued list; a rollback restores it in place", () => {
  const list = [job(1), job(2), job(3)]
  const input = listInput(DEFAULT_FILTERS)
  const intent: Intent = { kind: "status", ids: [list[1]!.id], status: "skipped" }

  const after = applyToList(list, input, intent)
  expect(after.map((j) => [j.id, j.status])).toEqual([
    [list[0]!.id, "queued"],
    [list[1]!.id, "skipped"],
    [list[2]!.id, "queued"],
  ])
  expect(pruneList(after, input, intent.ids).map((j) => j.id)).toEqual([list[0]!.id, list[2]!.id])
  expect(pruneList(after, input, []).map((j) => j.id)).toEqual(list.map((j) => j.id))
  expect(revertList(after, input, [list[1]!]).map((j) => j.status)).toEqual(["queued", "queued", "queued"])
  const pruned = pruneList(after, input, intent.ids)
  expect(revertList(pruned, input, [list[1]!]).map((j) => j.id)).toEqual(list.map((j) => j.id))

  const all = applyToList(list, { limit: 51, order: "newest" }, intent)
  expect(all.map((j) => j.status)).toEqual(["queued", "skipped", "queued"])
  expect(revertList(all, { limit: 51, order: "newest" }, [list[1]!])[1]?.status).toBe("queued")
})

test("a rollback only puts back its own rows", () => {
  const list = [job(1), job(2), job(3)]
  const input = listInput(DEFAULT_FILTERS)
  const one = applyToList(list, input, { kind: "remove", ids: [list[0]!.id] })
  const both = applyToList(one, input, { kind: "remove", ids: [list[1]!.id] })
  expect(revertList(both, input, [list[0]!]).map((j) => j.id)).toEqual([list[0]!.id, list[2]!.id])
})

test("a skip never touches an applied row, a remove takes it", () => {
  const applied = job(1, { status: "applied" })
  const skip: Intent = { kind: "status", ids: [applied.id], status: "skipped" }
  expect(applyToList([applied], { limit: 51, order: "newest" }, skip)).toEqual([applied])
  expect(applyToCounts(counts, [applied], skip)).toEqual(counts)
  expect(applyToList([applied], { limit: 51, order: "newest" }, { kind: "remove", ids: [applied.id] })).toEqual([])
})

test("counts follow an intent and an exact rollback gives the old counts back", () => {
  const rows = [job(1), job(2, { source: "gmail" })]
  const skip: Intent = { kind: "status", ids: rows.map((r) => r.id), status: "skipped" }
  const skipped = applyToCounts(counts, rows, skip)
  expect(skipped.status).toEqual({ queued: 1, applied: 1, skipped: 2 })
  expect(revertCounts(skipped, rows, skip)).toEqual(counts)

  const remove: Intent = { kind: "remove", ids: rows.map((r) => r.id) }
  const removed = applyToCounts(counts, rows, remove)
  expect(removed).toEqual({ status: { queued: 1, applied: 1, skipped: 0 }, sources: [{ source: "manual", count: 2 }] })
  expect(revertCounts(removed, rows, remove)).toEqual(counts)

  const applied: Intent = { kind: "applied", ids: [rows[0]!.id] }
  expect(applyToCounts(counts, rows, applied).status).toEqual({ queued: 2, applied: 2, skipped: 0 })
})

test("a search filter keeps a restored row out of lists it would not match", () => {
  const row = job(1, { company: "Globex" })
  expect(revertList([], { limit: 51, order: "newest", q: "acme" }, [row])).toEqual([])
  expect(revertList([], { limit: 51, order: "newest", q: "GLOBEX" }, [row])).toEqual([row])
})

test("source names: known sources and gmail providers read plainly, anything else is kept as stored", () => {
  expect(sourceLabel("manual")).toBe("Added by hand")
  expect(sourceLabel("gmail")).toBe("Gmail alert")
  expect(sourceLabel("gmail:linkedin")).toBe("Gmail · LinkedIn")
  expect(sourceLabel("gmail:indeed")).toBe("Gmail · Indeed")
  expect(sourceLabel("gmail:somewhere")).toBe("Gmail · somewhere")
  expect(sourceLabel("<b>x</b>")).toBe("<b>x</b>")
})
