import { connect, FIELDS, FILLED, openApplication } from "../fixtures/application.ts"
import { expect, test } from "../fixtures/extension.ts"
import {
  APPLICATIONS_PATH,
  filledAndSubmitted,
  JOBS_PATH,
  keepPageOnSubmit,
  offered,
  plain,
  queueFor,
} from "../fixtures/next-job.ts"

const SUBMITTED = /^Submitted Backend Engineer at Acme\?/
const NEXT = "Next in your queue: Staff Engineer at Globex."

test.beforeEach(({ mockApi, fixtureServer }) => {
  mockApi.reset()
  fixtureServer.submissions.length = 0
})

test.afterEach(({ fixtureServer }) => {
  fixtureServer.submissions.length = 0
})

test("a submit offers the next queued job and nothing happens until the person chooses", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next, later } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next, later])
  await connect(serviceWorker, mockApi)
  const { toast } = await filledAndSubmitted(context, fixtureServer.origin)
  const tabs = context.pages().length
  const shown = await toast.waitFor(offered)

  expect(plain(shown.title)).toMatch(SUBMITTED)
  expect(plain(shown.title)).toContain(NEXT)
  expect(shown.buttons.map((b) => b.action)).toEqual(["open-next", "mark-applied", "not-now", "stop-next"])
  expect(mockApi.requests.filter((r) => r.path === JOBS_PATH)).toHaveLength(1)
  expect(mockApi.applications).toEqual([])
  expect(context.pages()).toHaveLength(tabs)
  expect(fixtureServer.submissions).toEqual([])
})

test("open next opens the job in a new tab and leaves the queue and the submitted job alone", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next, later } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next, later])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filledAndSubmitted(context, fixtureServer.origin)
  await toast.waitFor(offered)

  const [created] = await Promise.all([context.waitForEvent("page"), toast.click("open-next")])
  expect(created.url()).toBe(next.url)
  expect(page.url()).toBe(`${fixtureServer.origin}/ats/greenhouse.html`)
  expect(mockApi.applications).toEqual([])

  const after = await toast.waitFor((s) => s.buttons.some((b) => b.action === "mark-applied") && !offered(s))
  expect(plain(after.title)).toMatch(/^Opened in a new tab\. Submitted Backend Engineer at Acme\?/)
})

test("mark applied is still there when the person comes back from the opened tab", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  test.setTimeout(120_000)
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filledAndSubmitted(context, fixtureServer.origin)
  await toast.waitFor(offered)

  await toast.click("open-next")
  await toast.waitFor((s) => s.buttons.some((b) => b.action === "mark-applied") && !offered(s))
  // longer than the first toast waits: the person is busy in the opened tab, this one is not brought to the front
  await page.waitForTimeout(35_000)
  expect(mockApi.applications).toEqual([])

  await page.bringToFront()
  const back = await toast.waitFor((s) => s.buttons.some((b) => b.action === "mark-applied"))
  expect(plain(back.title)).toMatch(/^Opened in a new tab\. Submitted Backend Engineer at Acme\?/)
  await toast.click("mark-applied")
  await expect.poll(() => mockApi.applications).toEqual([{ jobId: current.id, ats: "other" }])
})

test("a toast nobody answered goes away and its offer is gone", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  test.setTimeout(180_000)
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { toast } = await filledAndSubmitted(context, fixtureServer.origin)
  await toast.waitFor(offered)
  await toast.waitFor((s) => s.buttons.length === 0, 90_000)

  const stored = await serviceWorker.evaluate(() => chrome.storage.session.get("nextJobOffers"))
  expect((stored.nextJobOffers as { offers: unknown[] }).offers).toEqual([])
  expect(mockApi.applications).toEqual([])
})

test("mark applied records the application only after the person confirms", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { toast } = await filledAndSubmitted(context, fixtureServer.origin)
  await toast.waitFor(offered)
  expect(mockApi.requests.some((r) => r.path === APPLICATIONS_PATH)).toBe(false)

  await toast.click("mark-applied")
  await expect.poll(() => mockApi.applications).toEqual([{ jobId: current.id, ats: "other" }])
  const after = await toast.waitFor((s) => s.title?.startsWith("Marked applied.") === true)
  expect(after.buttons.map((b) => b.action)).toEqual(["open-next", "not-now", "stop-next"])
})

test("not now does nothing and the same page is not asked again", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filledAndSubmitted(context, fixtureServer.origin)
  await toast.waitFor(offered)
  const tabs = context.pages().length

  await toast.click("not-now")
  await toast.waitFor((s) => s.buttons.length === 0)
  await page.locator(FIELDS.submit).click()
  await page.waitForTimeout(500)

  expect((await toast.snapshot()).buttons).toEqual([])
  expect(mockApi.requests.filter((r) => r.path === JOBS_PATH)).toHaveLength(1)
  expect(mockApi.applications).toEqual([])
  expect(context.pages()).toHaveLength(tabs)
})

test("don't ask on this site stops the offers for later submits", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const first = await filledAndSubmitted(context, fixtureServer.origin)
  await first.toast.waitFor(offered)
  await first.toast.click("stop-next")
  await first.toast.waitFor((s) => s.buttons.length === 0)
  await first.page.close()

  const { page, toast } = await filledAndSubmitted(context, fixtureServer.origin)
  await page.waitForTimeout(800)
  expect(offered(await toast.snapshot())).toBe(false)
  expect(mockApi.requests.filter((r) => r.path === JOBS_PATH)).toHaveLength(1)
  expect(mockApi.applications).toEqual([])
})

test("a page that is not in the queue is offered the next job only", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { next, later } = queueFor(fixtureServer.origin)
  mockApi.setQueue([next, later])
  await connect(serviceWorker, mockApi)
  const { toast } = await filledAndSubmitted(context, fixtureServer.origin)
  const shown = await toast.waitFor(offered)
  expect(plain(shown.title)).toBe(NEXT)
  expect(shown.buttons.map((b) => b.action)).toEqual(["open-next", "not-now", "stop-next"])
})

test("a submit that leaves the page shows the offer on the page it led to", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filledAndSubmitted(context, fixtureServer.origin, { stay: false })
  await page.waitForURL(/\/submit/)
  const shown = await toast.waitFor(offered)
  expect(plain(shown.title)).toMatch(SUBMITTED)
  expect(mockApi.applications).toEqual([])
})

test("an api that is down shows nothing and breaks nothing", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  mockApi.failQueue(503)
  await connect(serviceWorker, mockApi)
  const errors: string[] = []
  context.on("weberror", (error) => errors.push(error.error().message))
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  page.on("pageerror", (error) => errors.push(error.message))
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.requests.filter((r) => r.path === JOBS_PATH).length).toBe(1)
  await page.waitForTimeout(800)
  expect((await toast.snapshot()).buttons.some((b) => b.action === "open-next")).toBe(false)
  expect(errors).toEqual([])
  expect(mockApi.applications).toEqual([])
})

test("the offer is not shown on another site, and a late list does not follow the tab there", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next, queued } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const first = await filledAndSubmitted(context, fixtureServer.origin)
  await first.toast.waitFor(offered)

  await first.page.goto(`${queued}/ats/ashby.html`)
  await first.page.waitForTimeout(1_000)
  const moved = await first.toast.snapshot()
  expect(moved.buttons.some((b) => b.action === "open-next" || b.action === "mark-applied")).toBe(false)
  await first.page.close()

  mockApi.delayQueue(1_500)
  const { page, toast } = await filledAndSubmitted(context, fixtureServer.origin, { stay: true })
  await page.goto(`${queued}/ats/ashby.html`)
  await expect.poll(() => mockApi.requests.filter((r) => r.path === JOBS_PATH).length).toBe(2)
  await page.waitForTimeout(2_500)
  expect(offered(await toast.snapshot())).toBe(false)
  expect(mockApi.applications).toEqual([])
})
