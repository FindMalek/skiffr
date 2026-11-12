import type { BrowserContext, Page } from "@playwright/test"
import { canonicalizeJob } from "@skiffr/common"
import type { MockJob } from "../mock-api/server.ts"
import { FIELDS, FILLED, openApplication } from "./application.ts"
import { QUEUE_HOST } from "./extension.ts"
import type { ToastSnapshot } from "./toast.ts"

export const JOBS_PATH = "/rpc/jobs/list"
export const APPLICATIONS_PATH = "/rpc/applications/create"

const job = (n: number, url: string, title: string, company: string): MockJob => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  url,
  canonicalId: canonicalizeJob(url).canonicalId,
  title,
  company,
})

/** The page under test is the first job of the queue, the lever fixture is the next one (on a name the browser maps to the fixture server). */
export function queueFor(origin: string): { current: MockJob; next: MockJob; later: MockJob; queued: string } {
  const queued = `http://${QUEUE_HOST}:${new URL(origin).port}`
  return {
    queued,
    current: job(1, `${origin}/ats/greenhouse.html`, "Backend Engineer", "Acme"),
    next: job(2, `${queued}/ats/lever.html`, "Staff Engineer", "Globex"),
    later: job(3, `${queued}/ats/ashby.html`, "Data Engineer", "Initech"),
  }
}

export async function keepPageOnSubmit(page: Page): Promise<void> {
  await page.evaluate(() => document.addEventListener("submit", (event) => event.preventDefault()))
}

/** Opens the application, says yes to the fill and waits for it. No submit yet. */
export async function filled(context: BrowserContext, origin: string, options: { stay?: boolean } = {}) {
  const { page, toast } = await openApplication(context, origin)
  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))
  if (options.stay !== false) await keepPageOnSubmit(page)
  return { page, toast }
}

/** Fills, then submits with a real click on the submit button. */
export async function filledAndSubmitted(context: BrowserContext, origin: string, options: { stay?: boolean } = {}) {
  const made = await filled(context, origin, options)
  await made.page.locator(FIELDS.submit).click()
  return made
}

export const offered = (s: ToastSnapshot): boolean =>
  s.title !== null && s.title !== "" && s.buttons.some((b) => b.action === "open-next")

/** The title with the invisible isolates around the job text taken out. */
export const plain = (text: string | null | undefined): string => (text ?? "").replace(/[⁨⁩]/g, "")

/** What a page can measure of the toast: its host element, never what is inside the closed root. */
export function hostBox(page: Page) {
  return page.evaluate(() => {
    const host = [...document.documentElement.children].find((el) => el.tagName.startsWith("X-"))
    if (!host) return null
    const box = host.getBoundingClientRect()
    return {
      width: box.width,
      height: box.height,
      scrollHeight: host.scrollHeight,
      scrollWidth: host.scrollWidth,
      clientHeight: host.clientHeight,
      offsetHeight: (host as HTMLElement).offsetHeight,
    }
  })
}
