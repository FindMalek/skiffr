import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { Browser } from "@playwright/test"

/** Opens the page from disk with the network off. A clean snapshot makes no request but its own and logs no error. */
export async function verifyOffline(browser: Browser, html: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "skiffr-snapshot-"))
  const file = join(dir, "index.html")
  await writeFile(file, html)
  const context = await browser.newContext({ offline: true, serviceWorkers: "block" })
  try {
    const page = await context.newPage()
    const problems: string[] = []
    const own = pathToFileURL(file).href
    page.on("request", (request) => {
      if (request.url() !== own) problems.push(`request: ${request.url().slice(0, 100)}`)
    })
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console error: ${message.text().slice(0, 100)}`)
    })
    page.on("pageerror", (error) => problems.push(`page error: ${error.message.slice(0, 100)}`))
    await page.goto(own, { waitUntil: "load" })
    await page.waitForTimeout(300)
    if (page.url() !== own) problems.push(`navigated away: ${page.url().slice(0, 100)}`)
    return problems
  } finally {
    await context.close()
    await rm(dir, { recursive: true, force: true })
  }
}
