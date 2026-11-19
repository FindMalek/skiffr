import { expect, test } from "bun:test"
import type { ExtensionStatus, Job, JobCounts } from "@skiffr/common/schemas"
import { renderToStaticMarkup } from "react-dom/server"
import { type SetupItem, setupItems } from "@/lib/today"
import { ActivityView, ErrorBox, SetupView, UpNextView, WeekView } from "./today-view"

const RETRY = '<button type="button">Try again</button>'
const retry = <button type="button">Try again</button>
const counts = { status: { queued: 2, applied: 1, skipped: 0 }, sources: [] } as JobCounts
const job = {
  id: "00000000-0000-4000-8000-000000000001",
  url: "https://boards.greenhouse.io/northwind/jobs/1",
  title: "Staff engineer",
  company: "Northwind",
  source: "gmail:other",
  queuedAt: new Date("2026-11-18T09:00:00Z"),
} as Job
const notConnected = { state: "never", lastSeenAt: null } as ExtensionStatus

test("an empty queue names the next step, a queued job shows its source as a name", () => {
  expect(
    renderToStaticMarkup(
      <UpNextView next={{ ok: true, value: null }} counts={{ ok: true, value: counts }} retry={retry} />,
    ),
  ).toContain("Your queue is empty")
  const html = renderToStaticMarkup(
    <UpNextView next={{ ok: true, value: job }} counts={{ ok: true, value: counts }} retry={retry} />,
  )
  expect(html).toContain("Staff engineer")
  expect(html).toContain("Gmail alert")
  expect(html).not.toContain("gmail:other")
  expect(html).toContain('href="https://boards.greenhouse.io/northwind/jobs/1"')
})

test("a failed counts call keeps the job on top, it only drops the counts line", () => {
  const html = renderToStaticMarkup(<UpNextView next={{ ok: true, value: job }} counts={{ ok: false }} retry={retry} />)
  expect(html).toContain("Staff engineer")
  expect(html).not.toContain("queued, 1 applied")
  expect(html).not.toContain('role="alert"')
})

test("a failed queue says so in an alert, with its own retry", () => {
  const html = renderToStaticMarkup(
    <UpNextView next={{ ok: false }} counts={{ ok: true, value: counts }} retry={retry} />,
  )
  expect(html).toContain('role="alert"')
  expect(html).toContain("Could not load your queue.")
  expect(html).toContain(RETRY)
})

test("set up lists what is missing and disappears once every check is done", () => {
  const open = renderToStaticMarkup(
    <SetupView items={setupItems({ extension: notConnected, jobs: 0 })} failed={[]} retry={retry} />,
  )
  expect(open).toContain("Connect the extension")
  expect(open).toContain("Add your first job")
  const done: SetupItem[] = setupItems({
    profile: { filled: 21, total: 21, missing: [] },
    extension: { state: "connected", lastSeenAt: null } as ExtensionStatus,
    jobs: 1,
    applications: 1,
    reviewedAnswers: 1,
  })
  expect(renderToStaticMarkup(<SetupView items={done} failed={[]} retry={retry} />)).toBe("")
})

test("a failed setup query still shows the checks that loaded", () => {
  const html = renderToStaticMarkup(
    <SetupView items={setupItems({ extension: notConnected })} failed={["your profile"]} retry={retry} />,
  )
  expect(html).toContain("Could not load your profile.")
  expect(html).toContain("Connect the extension")
})

test("this week shows the change against the week before, and a failed week says so", () => {
  const html = renderToStaticMarkup(
    <WeekView
      applications={{ ok: true, value: { thisWeek: 5, previous: 3 } }}
      autofill={{ ok: true, value: { fields: 12, accepted: 9 } }}
      retry={retry}
    />,
  )
  expect(html).toContain("+2 vs the 7 days before")
  expect(html).toContain("75% kept without edits")
  expect(
    renderToStaticMarkup(
      <WeekView
        applications={{ ok: false }}
        autofill={{ ok: true, value: { fields: 0, accepted: 0 } }}
        retry={retry}
      />,
    ),
  ).toContain("Could not load this week.")
})

test("activity shows the empty state with a next step, and a failure as an alert", () => {
  expect(renderToStaticMarkup(<ActivityView activity={{ ok: true, value: [] }} retry={retry} />)).toContain(
    "Nothing yet",
  )
  expect(renderToStaticMarkup(<ActivityView activity={{ ok: false }} retry={retry} />)).toContain('role="alert"')
})

test("the error box keeps its retry outside the alert text", () => {
  const html = renderToStaticMarkup(<ErrorBox what="the activity" retry={retry} />)
  expect(html).toContain('<p role="alert"')
  expect(html).toContain(RETRY)
})
