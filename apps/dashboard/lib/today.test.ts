import { expect, test } from "bun:test"
import type { ActivityEvent, ExtensionStatus } from "@skiffr/common/schemas"
import { dismissalKey } from "@/lib/answers"
import { emptyForm, formToProfile } from "./profile-form"
import {
  attentionItems,
  countOpenReview,
  deltaText,
  describeActivity,
  profileProgress,
  reviewLine,
  setupItems,
  sourceLabel,
  weekCompare,
} from "./today"

test("the profile count is the profile page count: 21 fields, nothing filled for a new user", () => {
  const progress = profileProgress(null)
  expect([progress.filled, progress.total, progress.missing.length]).toEqual([0, 21, 21])
  const started = formToProfile({ ...emptyForm(), firstName: "Ada" })
  expect(profileProgress(started).filled).toBe(1)
})

test("setup has five checks and each one is done by its own count", () => {
  const extension = { state: "never", lastSeenAt: null } as ExtensionStatus
  const open = setupItems({
    profile: { filled: 0, total: 21, missing: ["First name"] },
    extension,
    jobs: 0,
    applications: 0,
    reviewedAnswers: 0,
  })
  expect(open.map((item) => [item.id, item.done])).toEqual([
    ["profile", false],
    ["extension", false],
    ["job", false],
    ["application", false],
    ["answer", false],
  ])
  const done = setupItems({
    profile: { filled: 21, total: 21, missing: [] },
    extension: { state: "connected", lastSeenAt: new Date("2026-11-18T10:00:00Z") } as ExtensionStatus,
    jobs: 3,
    applications: 1,
    reviewedAnswers: 2,
  })
  expect(done.every((item) => item.done)).toBe(true)
})

test("source keys read as names, the raw key never reaches the page", () => {
  expect(["gmail:other", "watch:Brightmere", "manual", "extension", "x:y"].map(sourceLabel)).toEqual([
    "Gmail alert",
    "Careers page (Brightmere)",
    "Added by hand",
    "Extension",
    "Other source",
  ])
  const queued: ActivityEvent = {
    id: "1",
    at: new Date("2026-11-18T10:00:00Z"),
    kind: "jobs_queued",
    source: "gmail:other",
    count: 2,
  }
  expect(describeActivity(queued)).toBe("2 jobs queued from Gmail alerts")
  const failed: ActivityEvent = {
    id: "2",
    at: new Date("2026-11-18T10:00:00Z"),
    kind: "source_failed",
    source: "x:y",
    code: "boom",
  }
  expect(describeActivity(failed)).toBe("A job source failed to check")
  const byHand: ActivityEvent = {
    id: "3",
    at: new Date("2026-11-18T10:00:00Z"),
    kind: "jobs_queued",
    source: "manual",
    count: 1,
  }
  expect(describeActivity(byHand)).toBe("1 job queued by hand")
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

test("a keep card the user dismissed in this browser does not count, the others do", () => {
  const keep = { kind: "keep" as const, answer: { id: "a1", value: "yes" } }
  const flip = { kind: "flip_flop" as const, answer: { id: "a2", value: "no" } }
  expect(countOpenReview([keep, flip], new Set())).toBe(2)
  expect(countOpenReview([keep, flip], new Set([dismissalKey(keep)]))).toBe(1)
})

test("the week compares the last 7 days with the 7 before, by day", () => {
  const perDay = Array.from({ length: 14 }, (_, index) => ({
    day: `2026-11-${String(index + 1).padStart(2, "0")}`,
    count: index < 7 ? 1 : 3,
  }))
  const { thisWeek, previous } = weekCompare(perDay)
  expect([thisWeek, previous]).toEqual([21, 7])
  expect(deltaText(thisWeek, previous)).toBe("+14 vs the 7 days before")
  expect(deltaText(2, 2)).toBe("Same as the 7 days before")
  expect(deltaText(0, 0)).toBe("No applications in the last 14 days")
})

test("attention lists only what is broken now, and says where to fix it", () => {
  const now = new Date("2026-11-18T10:00:00Z")
  const day = 24 * 60 * 60 * 1000
  expect(
    attentionItems({ now, gmail: { connected: true, status: "active" }, sources: [{ status: "ok" }], tokens: [] }),
  ).toEqual([])
  const broken = attentionItems({
    now,
    gmail: { connected: true, status: "needs_reconnect" },
    sources: [{ status: "error" }, { status: "ok" }],
    tokens: [
      { expiresAt: new Date(now.getTime() + 2 * day), revokedAt: null },
      { expiresAt: new Date(now.getTime() + 2 * day), revokedAt: now },
      { expiresAt: new Date(now.getTime() + 30 * day), revokedAt: null },
    ],
  })
  expect(broken.map((item) => [item.id, item.text, item.href])).toEqual([
    ["gmail", "Gmail needs to be reconnected", "/settings/gmail"],
    ["sources", "1 careers page failed the last check", "/settings/sources"],
    ["tokens", "1 extension token expires within 7 days", "/settings/extension"],
  ])
})
