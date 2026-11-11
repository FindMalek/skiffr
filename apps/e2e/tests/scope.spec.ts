import type { BrowserContext, Page, Worker } from "@playwright/test"
import { expect, test } from "../fixtures/extension.ts"
import { ToastDriver } from "../fixtures/toast.ts"
import { MOCK_TOKEN, type MockApi } from "../mock-api/server.ts"

const APPLICATION = ["First name", "Last name", "Email"]

async function fillAndRead(
  context: BrowserContext,
  worker: Worker,
  api: MockApi,
  origin: string,
  path: string,
): Promise<{ page: Page; toast: ToastDriver; labels: string[] }> {
  await worker.evaluate((settings) => chrome.storage.local.set({ settings }), { apiUrl: api.url, token: MOCK_TOKEN })
  api.reset()
  const page = await context.newPage()
  await page.goto(`${origin}${path}`)
  await page.bringToFront()
  const toast = await ToastDriver.attach(context, page)
  await toast.waitFor((s) => s.buttons.some((b) => b.action === "yes"))
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && /^(Filled|Nothing)/.test(s.title))
  const lookup = api.requests.find((request) => request.path === "/rpc/learning/lookup")
  const fields = (lookup?.body as { fields?: { label?: string }[] } | undefined)?.fields ?? []
  const labels = fields.map((field) => (field.label ?? "").replace(/^[^:]*: /, ""))
  return { page, toast, labels }
}

const PAGES: Record<string, { path: string; labels: string[] }> = {
  "two forms on one page": { path: "/scope/two-forms.html", labels: [...APPLICATION, "Phone", "City"] },
  "a dialog with fields outside its form": {
    path: "/scope/dialog-outside.html",
    labels: [...APPLICATION, "Portfolio"],
  },
  "a form and inputs in a sibling div, no form tag around them": {
    path: "/scope/wrapper-sibling.html",
    labels: [...APPLICATION, "Phone", "City", "Website", "Notice period"],
  },
  "an input tied to the form by its form attribute from outside": {
    path: "/scope/form-attr.html",
    labels: [...APPLICATION, "Phone"],
  },
  "an application form whose id and action say search and comment": {
    path: "/scope/search-id.html",
    labels: APPLICATION,
  },
  "search, newsletter and two dialogs next to the application": {
    path: "/scope/noisy.html",
    labels: APPLICATION,
  },
}

for (const [name, expected] of Object.entries(PAGES)) {
  test(`reads every application field and nothing else: ${name}`, async ({
    context,
    serviceWorker,
    fixtureServer,
    mockApi,
  }) => {
    const { page, labels } = await fillAndRead(context, serviceWorker, mockApi, fixtureServer.origin, expected.path)
    expect(labels).toEqual(expected.labels)
    await expect(page.locator("#first_name")).toHaveValue("Ana")
    for (const noise of ["nl", "cookie_name", "chat"]) {
      if (await page.locator(`#${noise}`).count()) await expect(page.locator(`#${noise}`)).toHaveValue("")
    }
    expect(fixtureServer.submissions).toEqual([])
  })
}

test("the toast keeps its left to right layout on a right to left page", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  const { page, toast } = await fillAndRead(context, serviceWorker, mockApi, fixtureServer.origin, "/scope/rtl.html")
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe("rtl")
  expect(await toast.hostDirection()).toBe("ltr")
})
