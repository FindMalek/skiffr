import { expect, test } from "bun:test"
import { diffLines, diffWords, rejectedSummary } from "./cv-copy"

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
      { text: "a", kept: false },
      { text: "b", kept: true },
    ],
    after: [
      { text: "b", kept: true },
      { text: "c", kept: false },
    ],
  })
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
    "2 suggestions added something that is not in your resume or profile",
    "1 suggestion used hidden or look-alike characters",
  ])
})
