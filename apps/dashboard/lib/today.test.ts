import { expect, test } from "bun:test"
import type { ActivityEvent, ExtensionStatus } from "@skiffr/common/schemas"
import { emptyForm, formToProfile } from "./profile-form"
import { describeActivity, profileProgress, reviewLine, setupItems } from "./today"

test("the profile count is the profile page count: 21 fields, nothing filled for a new user", () => {
  const progress = profileProgress(null)
  expect([progress.filled, progress.total, progress.missing.length]).toEqual([0, 21, 21])
  const started = formToProfile({ ...emptyForm(), firstName: "Ada" })
  expect(profileProgress(started).filled).toBe(1)
})

test("setup asks for the profile and the extension until both are done", () => {
  const extension = { state: "never", lastSeenAt: null } as ExtensionStatus
  const items = setupItems({ profile: { filled: 0, total: 21, missing: ["First name"] }, extension })
  expect(items.map((item) => [item.id, item.done, item.detail])).toEqual([
    ["profile", false, "0 of 21 fields the extension can fill"],
    ["extension", false, "Not connected yet"],
  ])
  const done = setupItems({
    profile: { filled: 21, total: 21, missing: [] },
    extension: { state: "connected", lastSeenAt: new Date("2026-11-18T10:00:00Z") } as ExtensionStatus,
  })
  expect(done.map((item) => item.done)).toEqual([true, true])
})

test("activity reads as one plain sentence, with singular and plural counts", () => {
  const filled = (count: number): ActivityEvent => ({
    id: "1",
    at: new Date("2026-11-18T10:00:00Z"),
    kind: "fields_filled",
    site: "boards.greenhouse.io",
    count,
  })
  expect([describeActivity(filled(1)), describeActivity(filled(4))]).toEqual([
    "Filled 1 field on boards.greenhouse.io",
    "Filled 4 fields on boards.greenhouse.io",
  ])
})

test("the review line counts answers and says so when there are none", () => {
  expect([reviewLine(0), reviewLine(1), reviewLine(3)]).toEqual([
    "No answers need review.",
    "1 answer needs review.",
    "3 answers need review.",
  ])
})
