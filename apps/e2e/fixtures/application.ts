import type { BrowserContext, Page, Worker } from "@playwright/test"
import { MOCK_TOKEN, type MockApi } from "../mock-api/server.ts"
import { ATS_PAGES } from "./pages.ts"
import { ToastDriver } from "./toast.ts"

export const FIELDS = {
  first: "#first_name",
  last: "#last_name",
  email: "#email",
  phone: "#phone",
  why: "#job_application_answers_attributes_4_text_value",
  submit: "#submit_app",
}
export const FILLED = /^Filled \d+ fields?/

export async function connect(worker: Worker, api: MockApi, token = MOCK_TOKEN): Promise<void> {
  await worker.evaluate((settings) => chrome.storage.local.set({ settings }), { apiUrl: api.url, token })
}

export async function openApplication(
  context: BrowserContext,
  origin: string,
  path: string = ATS_PAGES.greenhouse.path,
): Promise<{ page: Page; toast: ToastDriver }> {
  const page = await context.newPage()
  await page.goto(`${origin}${path}`)
  await page.bringToFront()
  const toast = await ToastDriver.attach(context, page)
  await toast.waitFor((s) => s.buttons.some((b) => b.action === "yes"))
  return { page, toast }
}
