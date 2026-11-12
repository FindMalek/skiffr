import { expect, test } from "bun:test"
import type { StatsOverview } from "@skiffr/common/schemas"
import { renderToStaticMarkup } from "react-dom/server"
import { StatsView } from "./stats-view"

const group = (key: string, applied: number) => ({ key, applied, responded: 1, interview: 0, offer: 0 })

const stats: StatsOverview = {
  days: 7,
  from: "2026-11-06",
  to: "2026-11-12",
  perDay: [{ day: "2026-11-06", count: 2 }],
  perWeek: [{ week: "2026-11-02", count: 2 }],
  jobs: { queued: 0, applied: 2, skipped: 0 },
  bySource: [{ source: "<img src=x onerror=alert(1)>", queued: 0, applied: 2, skipped: 0 }],
  otherSources: null,
  stages: { applied: 2, responded: 1, interview: 0, offer: 0 },
  byAts: [group("<script>alert(1)</script>‮evil", 2)],
  byRole: [group("Engineer​", 2)],
  byMatch: [],
  timeToApply: { count: 2, medianHours: 5, buckets: [] },
  autofill: { fields: 0, accepted: 0, corrected: 0, cleared: 0, forms: 0, bySource: [] },
}

test("job text is shown as text, and a rate over too few applications is not shown", () => {
  const html = renderToStaticMarkup(<StatsView stats={stats} />)
  expect(html).not.toContain("<script")
  expect(html).not.toContain("<img")
  expect(html).not.toContain("‮")
  expect(html).toContain("&lt;script&gt;")
  expect(html).toContain("n/a")
  expect(html).not.toContain(">50%<")
})
