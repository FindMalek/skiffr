import { connect } from "../fixtures/application.ts"
import { expect, test } from "../fixtures/extension.ts"
import { ATS_PAGES } from "../fixtures/pages.ts"

const SETTINGS = { apiUrl: "http://127.0.0.1:4010", token: "skp_e2e_fake_token_not_a_secret" }

test("loads the built extension", async ({ serviceWorker, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/)
  const name = await serviceWorker.evaluate(() => chrome.runtime.getManifest().name)
  expect(name).toBe("Skiffr")
})

test("options page persists settings across reloads", async ({ optionsPage }) => {
  await optionsPage.getByLabel("API url").fill(SETTINGS.apiUrl)
  await optionsPage.getByLabel("Token").fill(SETTINGS.token)
  await optionsPage.getByRole("button", { name: "Save" }).click()
  await expect(optionsPage.getByRole("status")).toHaveText("Saved")

  await optionsPage.reload()
  await expect(optionsPage.getByLabel("API url")).toHaveValue(SETTINGS.apiUrl)
  await expect(optionsPage.getByLabel("Token")).toHaveValue(SETTINGS.token)
})

test("content script runs on a page", async ({ context, serviceWorker, fixtureServer }) => {
  const page = await context.newPage()
  await page.goto(`${fixtureServer.origin}${ATS_PAGES.greenhouse.path}`)
  await page.bringToFront()
  // "Receiving end does not exist" is what chrome throws when no content script is listening
  const reply = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id === undefined) throw new Error("no active tab")
    await chrome.tabs.sendMessage(tab.id, { type: "fill" })
    return "received"
  })
  expect(reply).toBe("received")
})

test("content scripts cannot read the stored token", async ({ context, optionsPage, serviceWorker, fixtureServer }) => {
  await optionsPage.getByLabel("API url").fill(SETTINGS.apiUrl)
  await optionsPage.getByLabel("Token").fill(SETTINGS.token)
  await optionsPage.getByRole("button", { name: "Save" }).click()
  await expect(optionsPage.getByRole("status")).toHaveText("Saved")

  const stored = await serviceWorker.evaluate(() => chrome.storage.local.get("settings"))
  expect(stored.settings?.token).toBe(SETTINGS.token)

  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const contexts: { id: number; origin: string }[] = []
  cdp.on("Runtime.executionContextCreated", ({ context: c }) => contexts.push({ id: c.id, origin: c.origin }))
  await cdp.send("Runtime.enable")
  await page.goto(`${fixtureServer.origin}${ATS_PAGES.greenhouse.path}`)

  await expect.poll(() => contexts.some((c) => c.origin.startsWith("chrome-extension://"))).toBe(true)
  const isolated = contexts.find((c) => c.origin.startsWith("chrome-extension://"))
  const result = await cdp.send("Runtime.evaluate", {
    contextId: isolated?.id,
    awaitPromise: true,
    expression: `chrome.storage.local.get("settings").then((s) => JSON.stringify(s), (e) => "denied: " + e.message)`,
  })
  expect(String(result.result.value)).toMatch(/^denied/)
  expect(String(result.result.value)).not.toContain(SETTINGS.token)
})

test("a slow storage read does not overwrite what was typed", async ({ context, extensionId }) => {
  await context.addInitScript(() => {
    const local = chrome.storage?.local as { get: (key: string) => Promise<unknown> } | undefined
    if (!local) return
    const read = local.get.bind(local)
    const flag = window as unknown as { storageRead?: boolean }
    local.get = async (key) => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      const stored = await read(key)
      setTimeout(() => {
        flag.storageRead = true
      }, 50)
      return stored
    }
  })
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await page.getByLabel("API url").fill(SETTINGS.apiUrl)
  await page.getByLabel("Token").fill(SETTINGS.token)
  await page.waitForFunction(() => (window as unknown as { storageRead?: boolean }).storageRead === true)
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("status")).toHaveText("Saved")

  await page.reload()
  await expect(page.getByLabel("API url")).toHaveValue(SETTINGS.apiUrl)
  await expect(page.getByLabel("Token")).toHaveValue(SETTINGS.token)
})

test("a worker that wakes with a token sends one heartbeat with the client header", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  mockApi.reset()
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send("ServiceWorker.enable")
  await cdp.send("ServiceWorker.stopAllWorkers")
  // the content script on this page messages the worker, which wakes it
  await page.goto(`${fixtureServer.origin}${ATS_PAGES.greenhouse.path}`)

  const beats = () => mockApi.requests.filter((request) => request.path === "/rpc/extension/whoami")
  await expect.poll(() => beats().length).toBe(1)
  expect(beats()[0]?.client).toMatch(/^extension-chrome\/\d+\.\d+\.\d+$/)
})
