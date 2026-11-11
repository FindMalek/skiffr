import { expect, test } from "bun:test"
import type { Answer } from "@skiffr/common/schemas"
import {
  applyDecision,
  applyRemoval,
  clip,
  createInflight,
  dismissalKey,
  displayText,
  editNotice,
  fetchAllAnswers,
  filterAnswers,
  paginate,
  parseDismissed,
  restoreRow,
  snapshotRow,
  sortAnswers,
  suggestionCopy,
  trendSentence,
} from "./answers"

let n = 0
function answer(over: Partial<Answer> & { rawLabel: string }): Answer {
  n += 1
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    normalizedLabel: over.rawLabel.toLowerCase(),
    value: "yes",
    source: "autofill",
    timesUsed: 0,
    timesCorrected: 0,
    status: "learned",
    lastCorrectedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }
}

const rows = [
  answer({ rawLabel: "Salary", timesCorrected: 5, timesUsed: 1, lastCorrectedAt: new Date("2026-01-01") }),
  answer({
    rawLabel: "Notice period",
    timesCorrected: 2,
    timesUsed: 9,
    status: "confirmed",
    lastCorrectedAt: new Date("2026-03-01"),
  }),
  answer({ rawLabel: "Visa", status: "rejected", timesUsed: 3 }),
  answer({ rawLabel: "الراتب المتوقع", normalizedLabel: "الراتب المتوقع", timesCorrected: 2 }),
]

test("search folds case, accents and hidden characters, and the status filter narrows it", () => {
  const accented = [answer({ rawLabel: "Téléphone​ number" })]
  expect(filterAnswers(accented, "telephone NUMBER", "all")).toHaveLength(1)
  expect(filterAnswers(rows, "sal", "all").map((r) => r.rawLabel)).toEqual(["Salary"])
  expect(filterAnswers(rows, "", "rejected").map((r) => r.rawLabel)).toEqual(["Visa"])
  expect(filterAnswers(rows, "الراتب", "all")).toHaveLength(1)
  expect(filterAnswers(rows, "(", "all")).toHaveLength(0)
})

test("sorting never mutates its input and ties fall back to the label", () => {
  const before = rows.map((r) => r.rawLabel)
  expect(sortAnswers(rows, "corrected").map((r) => r.rawLabel)).toEqual([
    "Salary",
    "Notice period",
    "الراتب المتوقع",
    "Visa",
  ])
  expect(sortAnswers(rows, "used")[0]?.rawLabel).toBe("Notice period")
  expect(
    sortAnswers(rows, "recent")
      .map((r) => r.rawLabel)
      .slice(0, 2),
  ).toEqual(["Notice period", "Salary"])
  expect(rows.map((r) => r.rawLabel)).toEqual(before)
})

test("a page past the end is clamped to the last one", () => {
  const view = paginate([1, 2, 3, 4, 5], 9, 2)
  expect(view).toEqual({ rows: [5], page: 3, pages: 3 })
  expect(paginate([], 1).pages).toBe(1)
})

test("bidi overrides and zero width characters are shown as code points, long text is cut on a grapheme", () => {
  expect(displayText("a‮b​c", 50)).toEqual({ text: "a[U+202E]b[U+200B]c", clipped: false })
  const family = "👨‍👩‍👧"
  expect(clip(`${family}${family}${family}`, 2)).toEqual({ text: `${family}${family}`, clipped: true })
  expect(clip("x".repeat(5000), 240).text).toHaveLength(240)
})

test("suggestion text matches what each button does", () => {
  expect(suggestionCopy("keep", 2).primary).toEqual({ label: "Keep", decision: "keep" })
  expect(suggestionCopy("keep", 2).secondary.decision).toBeNull()
  expect(suggestionCopy("flip_flop", 4).primary).toEqual({ label: "Stop filling", decision: "reject" })
  expect(suggestionCopy("flip_flop", 4).question).toContain("4 different answers")
  expect(suggestionCopy("cleared", 3).primary.decision).toBe("reject")
  // a cleared card only exists after skiffr already stopped: the text says so and says what stopping adds
  expect(suggestionCopy("cleared", 3).question).toContain("already stopped")
})

test("trend compares the first half of the applications with the second, in percent", () => {
  const point = (correctionsPerField: number, i: number) => ({
    applicationId: String(i),
    appliedAt: new Date(i * 1000),
    correctionsPerField,
  })
  expect(trendSentence([point(1, 1), point(1, 2), point(0.2, 3), point(0.4, 4)])).toBe(
    "You edit 30% of what skiffr fills, down from 100%.",
  )
  expect(trendSentence([point(1, 1)])).toContain("Not enough")
})

test("every page is read, a bank over one page reads the rest in parallel", async () => {
  const seen: number[] = []
  const bank = Array.from({ length: 1100 }, (_, i) => answer({ rawLabel: `q${String(i).padStart(4, "0")}` }))
  const client = {
    answers: {
      list: async ({ limit, offset }: { limit: number; offset: number }) => {
        seen.push(offset)
        return bank.slice(offset, offset + limit)
      },
    },
  }
  const all = await fetchAllAnswers(client as never)
  expect(all).toHaveLength(1100)
  expect(seen.sort((a, b) => a - b)).toEqual([0, 500, 1000, 1500])
  expect(all[0]?.rawLabel).toBe("q0000")

  seen.length = 0
  const small = await fetchAllAnswers({ answers: { list: async () => bank.slice(0, 3) } } as never)
  expect(small).toHaveLength(3)
})

test("a row inserted between two page reads shows up once, not twice", async () => {
  const rows = Array.from({ length: 600 }, (_, i) => answer({ rawLabel: `q${String(i).padStart(4, "0")}` }))
  let calls = 0
  const client = {
    answers: {
      list: async ({ limit, offset }: { limit: number; offset: number }) => {
        calls += 1
        // after the first page an insert at the front pushes the row at position 499 onto the second page
        const view = calls === 1 ? rows : [answer({ rawLabel: "a new one" }), ...rows]
        return view.slice(offset, offset + limit)
      },
    },
  }
  const all = await fetchAllAnswers(client as never)
  expect(new Set(all.map((row) => row.id)).size).toBe(all.length)
  // the new row sat before the page the first call had already read: it arrives with the refetch, nothing is doubled
  expect(all).toHaveLength(600)
})

test("a decision sets the status the click asked for, so repeating it changes nothing", () => {
  const a = answer({ rawLabel: "A" })
  const b = answer({ rawLabel: "B" })
  const suggestion = { kind: "keep", answer: a, count: 2 }
  const cache = { bank: [a, b], suggestions: [suggestion] }
  const once = applyDecision(cache, a.id, "reject")
  expect(once.bank.map((r) => r.status)).toEqual(["rejected", "learned"])
  expect(once.suggestions).toEqual([])
  expect(applyDecision(once, a.id, "reject")).toEqual(once)
  expect(applyDecision(once, a.id, "keep").bank[0]?.status).toBe("confirmed")
  expect(applyRemoval(cache, a.id).bank).toEqual([b])
  expect(applyRemoval(applyRemoval(cache, a.id), a.id)).toEqual(applyRemoval(cache, a.id))
})

test("a failed request puts back only its own row, not what another row changed meanwhile", () => {
  const a = answer({ rawLabel: "A" })
  const b = answer({ rawLabel: "B" })
  const suggestion = { kind: "keep", answer: a, count: 2 }
  const start = { bank: [a, b], suggestions: [suggestion] }
  const before = snapshotRow(start, a.id)
  const afterA = applyDecision(start, a.id, "reject")
  const afterB = applyDecision(afterA, b.id, "reject")
  const back = restoreRow(afterB, before, a.id)
  expect(back.bank.find((r) => r.id === a.id)?.status).toBe("learned")
  expect(back.bank.find((r) => r.id === b.id)?.status).toBe("rejected")
  expect(back.suggestions).toEqual([suggestion])
  const removed = restoreRow(applyRemoval(start, a.id), before, a.id)
  expect(removed.bank.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
})

test("a second request for a row waits for the first", () => {
  const inflight = createInflight()
  expect(inflight.start("a")).toBe(true)
  expect(inflight.start("a")).toBe(false)
  expect(inflight.start("b")).toBe(true)
  inflight.end("a")
  expect(inflight.start("a")).toBe(true)
})

test("whatever sits under the dismissed key, it never throws and only strings survive", () => {
  for (const raw of [null, "", "123", "true", "null", '{"a":1}', "not json", "[", '"x"']) {
    expect(parseDismissed(raw)).toEqual([])
  }
  expect(parseDismissed(`["a", 1, null, "b", {"c":1}, "${"x".repeat(300)}"]`)).toEqual(["a", "b"])
})

test("a dismissed card stays hidden when the answer is used, and comes back when its value changes", () => {
  const a = answer({ rawLabel: "A", value: "Masters" })
  const used = { ...a, timesUsed: 9, updatedAt: new Date() }
  expect(dismissalKey({ kind: "keep", answer: used })).toBe(dismissalKey({ kind: "keep", answer: a }))
  expect(dismissalKey({ kind: "keep", answer: { ...a, value: "PhD" } })).not.toBe(
    dismissalKey({ kind: "keep", answer: a }),
  )
  expect(dismissalKey({ kind: "stale", answer: a })).not.toBe(dismissalKey({ kind: "keep", answer: a }))
  expect(dismissalKey({ kind: "keep", answer: a })).not.toContain("Masters")
})

test("the edit dialog says a rejected answer comes back when saved", () => {
  expect(editNotice("rejected")).toContain("restores it")
  expect(editNotice("learned")).toContain("confirmed")
})
