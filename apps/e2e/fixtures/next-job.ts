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

export interface HitProbe {
  /** Points of a fine grid over the host box where a page's hit test lands on the toast host. */
  hits: number
  /** The first row, from the top of the host, where the toast takes clicks. */
  topRow: number | null
  box: { width: number; height: number }
  /** What a ResizeObserver and an IntersectionObserver on the host report once the toast has settled. */
  resize: { width: number; height: number } | null
  intersection: { width: number; height: number } | null
}

/**
 * Everything a page can learn about the size of the toast without reading it: hit testing a fine grid over the host
 * box (the host only takes clicks where the toast is), the host's own box, and observers on the host.
 */
export function probeToast(page: Page): Promise<HitProbe | null> {
  return page.evaluate(async () => {
    const host = [...document.documentElement.children].find((el) => el.tagName.startsWith("X-"))
    if (!host) return null
    let resize: { width: number; height: number } | null = null
    let intersection: { width: number; height: number } | null = null
    new ResizeObserver((entries) => {
      const rect = entries.at(-1)?.contentRect
      if (rect) resize = { width: rect.width, height: rect.height }
    }).observe(host)
    new IntersectionObserver((entries) => {
      const rect = entries.at(-1)?.intersectionRect
      if (rect) intersection = { width: rect.width, height: rect.height }
    }).observe(host)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const box = host.getBoundingClientRect()
    let hits = 0
    let topRow: number | null = null
    for (let y = Math.ceil(box.top) + 1; y < box.bottom; y += 2) {
      for (let x = Math.ceil(box.left) + 4; x < box.right; x += 12) {
        if (document.elementFromPoint(x, y) === host) {
          hits++
          topRow ??= y - box.top
        }
      }
    }
    return { hits, topRow, box: { width: box.width, height: box.height }, resize, intersection }
  })
}
