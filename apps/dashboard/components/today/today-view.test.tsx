import { expect, test } from "bun:test"
import type { ExtensionStatus, Job, JobCounts } from "@skiffr/common/schemas"
import { renderToStaticMarkup } from "react-dom/server"
import type { TodayData } from "@/lib/today"
import { TodayView } from "./today-view"

const RETRY = '<button type="button">Try again</button>'
const extension = { state: "never", lastSeenAt: null } as ExtensionStatus
const counts = { status: { queued: 0, applied: 0, skipped: 0 }, sources: [] } as JobCounts
const job = {
  id: "00000000-0000-4000-8000-000000000001",
  url: "https://boards.greenhouse.io/northwind/jobs/1",
  title: "Staff engineer",
  company: "Northwind",
  source: "greenhouse",
  queuedAt: new Date("2026-11-18T09:00:00Z"),
} as Job

const empty: TodayData = {
  queue: { ok: true, value: { counts, next: null } },
  profile: { ok: true, value: null },
  extension: { ok: true, value: extension },
  review: { ok: true, value: 0 },
  activity: { ok: true, value: [] },
}

function render(data: TodayData): string {
  return renderToStaticMarkup(<TodayView data={data} retry={<button type="button">Try again</button>} />)
}

test("a new user sees the next step in every section", () => {
  const html = render(empty)
  expect(html).toContain("Your queue is empty")
  expect(html).toContain("Fill your profile")
  expect(html).toContain("0 of 21 fields the extension can fill")
  expect(html).toContain("Set up the extension")
  expect(html).toContain("No answers need review.")
  expect(html).toContain("Nothing yet")
})

test("a queued job and the answers to review show with their counts", () => {
  const html = render({
    ...empty,
    queue: { ok: true, value: { counts: { status: { queued: 2, applied: 1, skipped: 0 }, sources: [] }, next: job } },
    review: { ok: true, value: 3 },
    activity: {
      ok: true,
      value: [
        {
          id: "a",
          at: new Date("2026-11-18T09:30:00Z"),
          kind: "job_applied",
          title: "Staff engineer",
          company: "Northwind",
        },
      ],
    },
  })
  expect(html).toContain("Staff engineer")
  expect(html).toContain("2 jobs queued, 1 applied, 0 skipped")
  expect(html).toContain('href="https://boards.greenhouse.io/northwind/jobs/1"')
  expect(html).toContain("3 answers need review.")
  expect(html).toContain("Applied to Staff engineer at Northwind")
  expect(html).not.toContain("Your queue is empty")
})

test("a failed section says what failed and keeps the others", () => {
  const html = render({ ...empty, queue: { ok: false }, extension: { ok: false } })
  expect(html).toContain("Could not load your queue.")
  expect(html).toContain("Could not load the extension status.")
  expect(html).toContain(RETRY)
  expect(html).toContain("No answers need review.")
  expect(html).not.toContain("Your queue is empty")
})
