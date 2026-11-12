import type { Page } from "@playwright/test"
import { connect, FIELDS, FILLED, openApplication } from "../fixtures/application.ts"
import { expect, test } from "../fixtures/extension.ts"
import { MOCK_TOKEN, type RecordedBatch } from "../mock-api/server.ts"

const RECORD_PATH = "/rpc/learning/record"

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

const eventFor = (batch: RecordedBatch | undefined, label: string) =>
  batch?.events.find((event) => event.label === label)

test("fill, edit by hand, submit: the correction is recorded", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)

  await page.locator(FIELDS.phone).fill("+351 000 111 222")
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.records.length).toBe(1)
  const [batch] = mockApi.records
  expect(batch?.siteKey).toBe(new URL(fixtureServer.origin).hostname)
  expect(batch?.batchId).toMatch(/^[0-9a-f-]{36}$/)
  expect(eventFor(batch, "Phone")).toMatchObject({
    filledValue: "+351 912 345 678",
    finalValue: "+351 000 111 222",
    source: "profile",
  })
  const records = mockApi.requests.filter((request) => request.path === RECORD_PATH)
  expect(records.every((request) => request.authorization === `Bearer ${MOCK_TOKEN}`)).toBe(true)
})

test("clearing a filled field records a clear", async ({ context, serviceWorker, fixtureServer, mockApi }) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)

  await page.locator(FIELDS.phone).fill("")
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.records.length).toBe(1)
  expect(eventFor(mockApi.records[0], "Phone")).toMatchObject({ filledValue: "+351 912 345 678", finalValue: "" })
})

test("fields left alone are confirmed, the empty ones are sent too", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)

  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.records.length).toBe(1)
  const [batch] = mockApi.records
  expect(eventFor(batch, "First Name")).toMatchObject({ filledValue: "Ana", finalValue: "Ana" })
  expect(eventFor(batch, "Why do you want to work at Acme?")).toMatchObject({ filledValue: "", finalValue: "" })
})

test("leaving the page records the correction too", async ({ context, serviceWorker, fixtureServer, mockApi }) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))

  await page.locator(FIELDS.why).fill("I like the product")
  await page.goto("about:blank")

  await expect.poll(() => mockApi.records.length).toBe(1)
  expect(eventFor(mockApi.records[0], "Why do you want to work at Acme?")).toMatchObject({
    filledValue: "",
    finalValue: "I like the product",
  })
})

test("a correction is used the next time the question comes up", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const first = await openApplication(context, fixtureServer.origin)
  await first.toast.click("yes")
  await first.toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(first.page)
  await first.page.locator(FIELDS.phone).fill("+351 000 111 222")
  await first.page.locator(FIELDS.submit).click()
  await expect.poll(() => mockApi.records.length).toBe(1)

  await first.page.close()

  const second = await openApplication(context, fixtureServer.origin)
  await second.toast.click("yes")
  await second.toast.waitFor((s) => s.title !== null && FILLED.test(s.title))

  await expect(second.page.locator(FIELDS.phone)).toHaveValue("+351 000 111 222")
  await expect(second.page.locator(FIELDS.first)).toHaveValue("Ana")
})

test("a batch that failed is sent again with the same batch id", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)
  await page.locator(FIELDS.phone).fill("+351 000 111 222")

  mockApi.failNext(503, "SERVICE_UNAVAILABLE")
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.records.length, { timeout: 10_000 }).toBe(1)
  const sent = mockApi.requests.filter((request) => request.path === RECORD_PATH)
  expect(sent).toHaveLength(2)
  expect(sent[0]?.body).toMatchObject({ batchId: mockApi.records[0]?.batchId })
  expect(sent[1]?.body).toEqual(sent[0]?.body)
})

test("private fields and card numbers never reach the api", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await page.evaluate(() => {
    document.querySelector("#custom_fields")?.insertAdjacentHTML(
      "beforeend",
      `<div class="field"><label for="ssn">Social security number</label><input id="ssn" type="text"></div>
       <div class="field"><label for="ref">Reference</label><input id="ref" type="text"></div>
       <div class="field"><label for="pw">Account password</label><input id="pw" type="password"></div>
       <div class="field"><label for="iban">Compte bancaire</label><input id="iban" type="text"></div>
       <div class="field"><label for="masked">Anything</label><input id="masked" type="text" style="-webkit-text-security: disc"></div>`,
    )
  })
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)

  await page.locator("#ssn").fill("078-05-1120")
  await page.locator("#ref").fill("4242.4242.4242.4242")
  await page.locator("#iban").fill("LEAK-bank-9981")
  await page.locator("#masked").fill("LEAK-masked-7731")
  await page.locator("#pw").fill("hunter2-secret")
  await page.locator(FIELDS.phone).fill("+351 000 111 222")
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.records.length).toBe(1)
  const sent = JSON.stringify(mockApi.requests.filter((request) => request.path === RECORD_PATH))
  for (const secret of ["078-05", "4242", "hunter2", "LEAK", "Social security", "password", "Compte", "Anything"]) {
    expect(sent).not.toContain(secret)
  }
  expect(sent).toContain("+351 000 111 222")
})

test("an api that is down does not break the page", async ({ context, serviceWorker, fixtureServer, mockApi }) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await serviceWorker.evaluate((settings) => chrome.storage.local.set({ settings }), {
    apiUrl: "http://127.0.0.1:9",
    token: MOCK_TOKEN,
  })

  await page.locator(FIELDS.phone).fill("+351 000 111 222")
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => fixtureServer.submissions.length).toBe(1)
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
  expect(mockApi.records).toEqual([])
})

test("closing the tab right after an edit still records it", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))

  await page.locator(FIELDS.phone).fill("+351 000 111 222")
  await page.close()

  await expect.poll(() => mockApi.records.length).toBe(1)
  expect(eventFor(mockApi.records[0], "Phone")?.finalValue).toBe("+351 000 111 222")
})

test("a submit the page stops, then a fixed value, records both", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await page.evaluate(() =>
    document.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault()
      event.stopPropagation()
    }),
  )

  await page.locator(FIELDS.phone).fill("+351 typo")
  await page.locator(FIELDS.submit).click()
  await expect.poll(() => mockApi.records.length).toBe(1)
  await page.locator(FIELDS.phone).fill("+351 000 111 222")
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.records.length).toBe(2)
  expect(eventFor(mockApi.records[0], "Phone")?.finalValue).toBe("+351 typo")
  expect(eventFor(mockApi.records[1], "Phone")).toMatchObject({
    filledValue: "+351 912 345 678",
    finalValue: "+351 000 111 222",
  })
  expect(mockApi.records[1]?.batchId).not.toBe(mockApi.records[0]?.batchId)
})

test("a second fill keeps the edits made before it and sends nothing early", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)
  await page.locator(FIELDS.email).fill("edited@example.com")

  await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id === undefined) throw new Error("no active tab")
    await chrome.tabs.sendMessage(tab.id, { type: "fill" }, { frameId: 0 })
  })
  await page.waitForTimeout(1_000)
  expect(mockApi.records).toEqual([])

  await page.locator(FIELDS.submit).click()
  await expect.poll(() => mockApi.records.length).toBe(1)
  expect(eventFor(mockApi.records[0], "Email")).toMatchObject({
    filledValue: "ana.silva@example.com",
    finalValue: "edited@example.com",
  })
})

test("a header search form submitting does not send the batch or its text", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<form id="site_search"><input id="q" type="text" aria-label="Look something up"><button>Go</button></form>`,
    )
  })
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)

  await page.locator("#q").fill("my secret search")
  await page.locator("#site_search button").click()
  await page.waitForTimeout(500)
  expect(mockApi.records).toEqual([])

  await page.locator(FIELDS.phone).fill("+351 000 111 222")
  await page.locator(FIELDS.submit).click()
  await expect.poll(() => mockApi.records.length).toBe(1)
  expect(eventFor(mockApi.records[0], "Phone")?.finalValue).toBe("+351 000 111 222")
})

test("a field relabelled after the fill is not recorded", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)

  await page.evaluate(() => {
    const label = document.querySelector("label[for=phone]")
    if (label) label.textContent = "Passport number"
  })
  await page.locator(FIELDS.phone).fill("X1234567")
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.records.length).toBe(1)
  expect(JSON.stringify(mockApi.requests.filter((request) => request.path === RECORD_PATH))).not.toContain("X1234567")
})

test("a control the page swapped in after the fill is read as typed, not as accepted", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await keepPageOnSubmit(page)

  await page.evaluate(() => {
    const old = document.querySelector("#phone")
    old?.replaceWith((old as HTMLElement).cloneNode(true))
  })
  await page.locator(FIELDS.phone).fill("+351 000 111 222")
  await page.locator(FIELDS.submit).click()

  await expect.poll(() => mockApi.records.length).toBe(1)
  expect(eventFor(mockApi.records[0], "Phone")).toMatchObject({
    filledValue: "+351 912 345 678",
    finalValue: "+351 000 111 222",
  })
})
