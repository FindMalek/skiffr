import { connect, FIELDS, FILLED, openApplication } from "../fixtures/application.ts"
import { expect, test } from "../fixtures/extension.ts"
import { defaultMapFields, MOCK_TOKEN } from "../mock-api/server.ts"

test.beforeEach(({ mockApi, fixtureServer }) => {
  mockApi.reset()
  fixtureServer.submissions.length = 0
})

test("yes fills the form from the profile, never submits and keeps what was typed", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  await page.fill(FIELDS.phone, "+1 typed by me")

  await toast.click("yes")
  const result = await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))

  expect(result.title).toMatch(FILLED)
  await expect(page.locator(FIELDS.first)).toHaveValue("Ana")
  await expect(page.locator(FIELDS.last)).toHaveValue("Silva")
  await expect(page.locator(FIELDS.email)).toHaveValue("ana.silva@example.com")
  await expect(page.locator(FIELDS.phone)).toHaveValue("+1 typed by me")
  expect(fixtureServer.submissions).toEqual([])

  const calls = mockApi.requests.map((request) => request.path)
  expect(calls).toContain("/rpc/learning/lookup")
  expect(calls).toContain("/rpc/ai/mapFields")
  expect(calls).toContain("/rpc/profile/get")
  expect(mockApi.requests.every((request) => request.authorization === `Bearer ${MOCK_TOKEN}`)).toBe(true)
  expect(JSON.stringify(mockApi.requests.map((request) => request.body))).not.toContain("typed by me")
})

test("a field the server calls sensitive is never filled, even when its mapping says profile", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  mockApi.onMapFields((fields) =>
    defaultMapFields(fields).map((mapping) => {
      const field = fields.find((candidate) => candidate.id === mapping.id)
      return /phone/i.test(`${field?.label} ${field?.name}`)
        ? { ...mapping, sensitive: true, category: "other" as const }
        : mapping
    }),
  )
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)

  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))

  await expect(page.locator(FIELDS.first)).toHaveValue("Ana")
  await expect(page.locator(FIELDS.phone)).toHaveValue("")
})

test("an api from before the sensitive verdict still fills what the floor lets through", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  mockApi.legacyMapFields(true)
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)

  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))

  await expect(page.locator(FIELDS.first)).toHaveValue("Ana")
  await expect(page.locator(FIELDS.email)).toHaveValue("ana.silva@example.com")
})

test("the shortcut path fills the active tab", async ({ context, serviceWorker, fixtureServer, mockApi }) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)

  await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id === undefined) throw new Error("no active tab")
    await chrome.tabs.sendMessage(tab.id, { type: "fill" }, { frameId: 0 })
  })

  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await expect(page.locator(FIELDS.first)).toHaveValue("Ana")
  expect(fixtureServer.submissions).toEqual([])
})

test("one api hiccup is retried and the fill still works", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)
  mockApi.failNext(503, "SERVICE_UNAVAILABLE")

  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await expect(page.locator(FIELDS.first)).toHaveValue("Ana")
})

test("a rejected token says to reconnect and offers the settings", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi, "skp_not_the_token")
  const { page, toast } = await openApplication(context, fixtureServer.origin)

  await toast.click("yes")
  const result = await toast.waitFor((s) => s.title !== null && /no longer accepts/i.test(s.title))

  expect(result.buttons.map((button) => button.action)).toContain("settings")
  await expect(page.locator(FIELDS.first)).toHaveValue("")
})

test("an api that is down says so and offers a retry", async ({ context, serviceWorker, fixtureServer }) => {
  await serviceWorker.evaluate((settings) => chrome.storage.local.set({ settings }), {
    apiUrl: "http://127.0.0.1:9",
    token: MOCK_TOKEN,
  })
  const { page, toast } = await openApplication(context, fixtureServer.origin)

  await toast.click("yes")
  const result = await toast.waitFor((s) => s.title !== null && /Could not reach/.test(s.title), 25_000)

  expect(result.buttons.map((button) => button.action)).toContain("retry")
  await expect(page.locator(FIELDS.first)).toHaveValue("")
})

test("a site entry from the lookup wins over the model's mapping", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  mockApi.onLookup(({ fields }) =>
    fields.map(({ id, label }) =>
      /first name/i.test(label)
        ? { fieldId: id, source: "site", value: "Ana Maria", autofill: true }
        : { fieldId: id, source: "none" },
    ),
  )
  const { page, toast } = await openApplication(context, fixtureServer.origin)

  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))

  await expect(page.locator(FIELDS.first)).toHaveValue("Ana Maria")
  await expect(page.locator(FIELDS.last)).toHaveValue("Silva")
})

test("after Enter on Yes the keyboard focus stays on the toast, also once the form was filled", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openApplication(context, fixtureServer.origin)

  await toast.focus("yes")
  await page.keyboard.press("Enter")

  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  await expect(page.locator(FIELDS.first)).toHaveValue("Ana")
  // filling moves the focus through the page's fields: the result must take it back from them
  for (const wait of [50, 300, 1_500]) {
    await page.waitForTimeout(wait)
    expect(await toast.activeTag()).toMatch(/^x-/)
  }
})
