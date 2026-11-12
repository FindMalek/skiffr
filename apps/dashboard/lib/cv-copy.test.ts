import { expect, test } from "bun:test"
import { diffLines, diffWords, rejectedSummary, reorderedOnly } from "./cv-copy"

test("a reworded sentence shows only the words that changed", () => {
  expect(diffWords("Cut deploy time with Docker", "Cut deploy time using Docker")).toEqual([
    { type: "same", text: "Cut deploy time " },
    { type: "del", text: "with" },
    { type: "add", text: "using" },
    { type: "same", text: " Docker" },
  ])
  expect(diffWords("same", "same")).toEqual([{ type: "same", text: "same" }])
})

test("lines are marked by whether the other side still has them", () => {
  expect(diffLines({ before: ["a", "b"], after: ["b", "c"] })).toEqual({
    before: [
      { text: "a", kept: false, moved: false },
      { text: "b", kept: true, moved: false },
    ],
    after: [
      { text: "b", kept: true, moved: true },
      { text: "c", kept: false, moved: false },
    ],
  })
})

test("a list in a new order is a reorder, one with a line added or dropped is not", () => {
  const order = { before: ["Go", "TypeScript"], after: ["TypeScript", "Go"] }
  expect(reorderedOnly(order)).toBe(true)
  expect(diffLines(order).after.map((line) => line.moved)).toEqual([true, true])
  expect(reorderedOnly({ before: ["Go", "SQL"], after: ["Go"] })).toBe(false)
})

test("dropped suggestions are counted per reason, and only known codes get a sentence", () => {
  expect(
    rejectedSummary([
      { reason: "invented_fact" },
      { reason: "invented_fact" },
      { reason: "constructor" },
      { reason: "unicode" },
    ]),
  ).toEqual([
    "2 suggestions wrote something that is not copied from your resume",
    "1 suggestion used hidden or look-alike characters",
  ])
})
