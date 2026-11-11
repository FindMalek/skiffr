import { expect, test } from "bun:test"
import type { Answer } from "@skiffr/common/schemas"
import {
  clip,
  displayText,
  fetchAllAnswers,
  filterAnswers,
  paginate,
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
  expect(suggestionCopy("flip_flop", 4).primary.decision).toBe("reject")
  expect(suggestionCopy("flip_flop", 4).question).toContain("4 times")
  expect(suggestionCopy("cleared", 3).primary.decision).toBe("reject")
})

test("trend compares the first half of the applications with the second", () => {
  const point = (correctionsPerField: number, i: number) => ({
    applicationId: String(i),
    appliedAt: new Date(i * 1000),
    correctionsPerField,
  })
  expect(trendSentence([point(1, 1), point(1, 2), point(0.2, 3), point(0.4, 4)])).toBe(
    "Corrections per field went down from 1.00 to 0.30.",
  )
  expect(trendSentence([point(1, 1)])).toContain("Not enough")
})

test("every page of the bank is read until one comes back short", async () => {
  const seen: number[] = []
  const bank = Array.from({ length: 1100 }, (_, i) => answer({ rawLabel: `q${i}` }))
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
  expect(seen).toEqual([0, 500, 1000])
})
