import type { Page } from "@playwright/test"
import { connect, FIELDS } from "../fixtures/application.ts"
import { expect, test } from "../fixtures/extension.ts"
import { APPLICATIONS_PATH, filled, JOBS_PATH, offered, queueFor } from "../fixtures/next-job.ts"

test.beforeEach(({ mockApi, fixtureServer }) => {
  mockApi.reset()
  fixtureServer.submissions.length = 0
})

test.afterEach(({ fixtureServer }) => {
  fixtureServer.submissions.length = 0
})

const FORM = FIELDS.submit

/** A page that wants the offer toast to show up fires submits itself. */
const scripted = {
  /**
   * The browser counts a script run by the test driver as a gesture, so these run from timers: by then the clicks the
   * test made (the one that said yes to the fill) are older than the few seconds a click stays recent.
   */
  later: (page: Page, delayMs: number) =>
    page.evaluate(
      ({ selector, delay }) => {
        const form = (document.querySelector(selector) as HTMLButtonElement).form as HTMLFormElement
        const button = document.querySelector(selector) as HTMLButtonElement
        setTimeout(() => form.requestSubmit(), delay)
        setTimeout(() => button.click(), delay + 200)
        setTimeout(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })), delay + 400)
      },
      { selector: FORM, delay: delayMs },
    ),
  formSubmit: (page: Page) =>
    page.evaluate(
      (selector) => ((document.querySelector(selector) as HTMLButtonElement).form as HTMLFormElement).submit(),
      FORM,
    ),
  requestSubmit: (page: Page) =>
    page.evaluate(
      (selector) => ((document.querySelector(selector) as HTMLButtonElement).form as HTMLFormElement).requestSubmit(),
      FORM,
    ),
}

const asked = (requests: { path: string }[]): number => requests.filter((r) => r.path === JOBS_PATH).length

test("submits the page makes up do not ask: a synthetic event, form.submit(), and a script submit with no click or key", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  test.setTimeout(90_000)
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filled(context, fixtureServer.origin)

  await scripted.later(page, 6_000)
  await page.waitForTimeout(7_500)
  expect(asked(mockApi.requests)).toBe(0)
  expect(offered(await toast.snapshot())).toBe(false)

  await scripted.formSubmit(page)
  await page.waitForURL(/\/submit/)
  await page.waitForTimeout(1_000)
  expect(asked(mockApi.requests)).toBe(0)
  expect(mockApi.applications).toEqual([])
})

test("a script submit right after the person clicked still asks, and still only offers", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filled(context, fixtureServer.origin)
  await page.mouse.click(900, 500)
  await scripted.requestSubmit(page)
  await toast.waitFor(offered)
  expect(mockApi.applications).toEqual([])
  expect(fixtureServer.submissions).toEqual([])
})

test("pressing Enter in a field submits the form and asks", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filled(context, fixtureServer.origin)
  await page.locator(FIELDS.phone).press("Enter")
  await toast.waitFor(offered)
})

test("the page cannot read, click or drive the toast", async ({ context, serviceWorker, fixtureServer, mockApi }) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filled(context, fixtureServer.origin)
  await page.locator(FORM).click()
  await toast.waitFor(offered)
  const tabs = context.pages().length

  const probe = await page.evaluate(() => {
    const host = [...document.documentElement.children].find((el) => el.tagName.startsWith("X-")) as HTMLElement
    const box = host.getBoundingClientRect()
    const seen = {
      shadowRoot: host.shadowRoot,
      children: host.children.length,
      text: host.textContent,
      html: host.innerHTML,
      // the host is a frame around the toast: outside the toast the page is clickable
      hit: document.elementFromPoint(box.left + 10, box.top + 10)?.tagName,
    }
    host.click()
    for (const type of ["click", "pointerdown", "pointerup", "mousedown", "mouseup"]) {
      host.dispatchEvent(
        new MouseEvent(type, { bubbles: true, composed: true, clientX: box.right - 40, clientY: box.bottom - 30 }),
      )
    }
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }))
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }))
    return seen
  })
  expect(probe).toEqual({ shadowRoot: null, children: 0, text: "", html: "", hit: expect.not.stringMatching(/^X-/) })

  await page.waitForTimeout(500)
  expect(offered(await toast.snapshot())).toBe(true)
  expect(mockApi.applications).toEqual([])
  expect(context.pages()).toHaveLength(tabs)
})

test("the page cannot decide for the person: no extension api in the page, messages and events do nothing", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filled(context, fixtureServer.origin)
  await page.locator(FORM).click()
  await toast.waitFor(offered)
  const tabs = context.pages().length
  const stored = await serviceWorker.evaluate(() => chrome.storage.session.get("nextJobOffers"))
  const offerId = (stored.nextJobOffers as { offers: { id: string }[] }).offers[0]?.id as string
  expect(offerId).toMatch(/^[0-9a-f-]{36}$/)

  const reach = await page.evaluate((id) => {
    const message = { type: "next-decision", offerId: id, action: "mark" }
    window.postMessage(message, "*")
    document.dispatchEvent(new CustomEvent("next-decision", { detail: message, bubbles: true, composed: true }))
    const scope = globalThis as unknown as { chrome?: { runtime?: { sendMessage?: unknown } }; browser?: unknown }
    return { sendMessage: typeof scope.chrome?.runtime?.sendMessage, browser: typeof scope.browser }
  }, offerId)
  expect(reach).toEqual({ sendMessage: "undefined", browser: "undefined" })

  await page.waitForTimeout(500)
  expect(mockApi.applications).toEqual([])
  expect(context.pages()).toHaveLength(tabs)
  expect(offered(await toast.snapshot())).toBe(true)
})

test("an extension page, which is not a content script, gets no answer to a decision or a submit", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
  optionsPage,
}) => {
  const { current, next } = queueFor(fixtureServer.origin)
  mockApi.setQueue([current, next])
  await connect(serviceWorker, mockApi)
  const { page, toast } = await filled(context, fixtureServer.origin)
  await page.locator(FORM).click()
  await toast.waitFor(offered)
  const stored = await serviceWorker.evaluate(() => chrome.storage.session.get("nextJobOffers"))
  const offerId = (stored.nextJobOffers as { offers: { id: string }[] }).offers[0]?.id as string
  const before = asked(mockApi.requests)

  const replies = await optionsPage.evaluate(
    async ({ id, site }) => {
      const send = (message: unknown) =>
        chrome.runtime.sendMessage(message).then(
          (reply) => reply ?? null,
          () => "rejected",
        )
      return [
        await send({ type: "next-decision", offerId: id, action: "mark" }),
        await send({ type: "next-decision", offerId: id, action: "open" }),
        await send({ type: "application-submitted", siteKey: site }),
      ]
    },
    { id: offerId, site: new URL(fixtureServer.origin).hostname },
  )
  expect(replies.every((reply) => reply === null || reply === "rejected")).toBe(true)
  expect(mockApi.applications).toEqual([])
  expect(asked(mockApi.requests)).toBe(before)
  expect(mockApi.requests.some((r) => r.path === APPLICATIONS_PATH)).toBe(false)
})
