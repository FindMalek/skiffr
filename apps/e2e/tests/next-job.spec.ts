import type { Page } from "@playwright/test"
import { canonicalizeJob } from "@skiffr/common"
import { connect, FIELDS, FILLED, openApplication } from "../fixtures/application.ts"
import { expect, QUEUE_HOST, test } from "../fixtures/extension.ts"
import type { ToastSnapshot } from "../fixtures/toast.ts"
import type { MockJob } from "../mock-api/server.ts"

const JOBS_PATH = "/rpc/jobs/list"
const APPLICATIONS_PATH = "/rpc/applications/create"
const SUBMITTED = /^Submitted Backend Engineer at Acme\?/
const NEXT = "Next in your queue: Staff Engineer at Globex."

const job = (n: number, url: string, title: string, company: string): MockJob => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  url,
  canonicalId: canonicalizeJob(url).canonicalId,
  title,
  company,
})

/** The page under test is the first job of the queue, the lever fixture is the next one (on a name the browser maps to the fixture server). */
function queueFor(origin: string): { current: MockJob; next: MockJob; later: MockJob } {
  const queued = `http://${QUEUE_HOST}:${new URL(origin).port}`
  return {
    current: job(1, `${origin}/ats/greenhouse.html`, "Backend Engineer", "Acme"),
    next: job(2, `${queued}/ats/lever.html`, "Staff Engineer", "Globex"),
    later: job(3, `${queued}/ats/ashby.html`, "Data Engineer", "Initech"),
  }
}

test.beforeEach(({ mockApi, fixtureServer }) => {
  mockApi.reset()
  fixtureServer.submissions.length = 0
})

test.afterEach(({ fixtureServer }) => {
  fixtureServer.submissions.length = 0
})

async function keepPageOnSubmit(page: Page): Promise<void> {
  await page.evaluate(() => document.addEventListener("submit", (event) => event.preventDefault()))
}

async function filledAndSubmitted(
  context: Parameters<typeof openApplication>[0],
  origin: string,
  options: { stay?: boolean } = {},
) {
  const { page, toast } = await openApplication(context, origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  if (options.stay !== false) await keepPageOnSubmit(page)
  await page.locator(FIELDS.submit).click()
  return { page, toast }
}

const offered = (s: ToastSnapshot) =>
  s.title !== null && s.title !== "" && s.buttons.some((b) => b.action === "open-next")

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

  expect(shown.title).toMatch(SUBMITTED)
  expect(shown.title).toContain(NEXT)
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

  await page.bringToFront()
  const after = await toast.waitFor((s) => s.buttons.some((b) => b.action === "mark-applied") && !offered(s))
  expect(after.title).toMatch(/^Opened in a new tab\. Submitted Backend Engineer at Acme\?/)
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
  expect(shown.title).toBe(NEXT)
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
  expect(shown.title).toMatch(SUBMITTED)
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
