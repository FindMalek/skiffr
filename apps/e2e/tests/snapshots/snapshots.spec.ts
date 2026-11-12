import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { connect, FILLED, openApplication } from "../../fixtures/application.ts"
import { expect, test } from "../../fixtures/extension.ts"
import { checkSnapshots, SNAPSHOTS_DIR } from "../../tools/snapshot/check.ts"
import { findViolations } from "../../tools/snapshot/sanitize.ts"

interface Meta {
  fields: Record<string, number>
}

const NOT_FILLABLE = new Set(["hidden", "file", "password", "submit", "button", "reset", "image"])

const slugs = existsSync(SNAPSHOTS_DIR)
  ? readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(SNAPSHOTS_DIR, entry.name, "index.html")))
      .map((entry) => entry.name)
      .sort()
  : []

test.beforeEach(({ mockApi, fixtureServer }) => {
  mockApi.reset()
  fixtureServer.submissions.length = 0
})

test("the snapshots folder passes the full check", async () => {
  expect(await checkSnapshots(SNAPSHOTS_DIR)).toEqual([])
})

for (const slug of slugs) {
  test(`snapshot ${slug} is clean, fills, and leaves sensitive fields alone`, async ({
    context,
    serviceWorker,
    fixtureServer,
    mockApi,
  }) => {
    const html = readFileSync(join(SNAPSHOTS_DIR, slug, "index.html"), "utf8")
    const meta = JSON.parse(readFileSync(join(SNAPSHOTS_DIR, slug, "meta.json"), "utf8")) as Meta
    expect(findViolations(html)).toEqual([])

    await connect(serviceWorker, mockApi)
    const path = `/snapshots/${slug}/index.html`
    const { page, toast } = await openApplication(context, fixtureServer.origin, path)
    await toast.click("yes")
    const result = await toast.waitFor((s) => s.title !== null && FILLED.test(s.title))

    const filled = Number(/^Filled (\d+)/.exec(result.title ?? "")?.[1])
    const fillable = Object.entries(meta.fields)
      .filter(([kind]) => !NOT_FILLABLE.has(kind))
      .reduce((sum, [, count]) => sum + count, 0)
    expect(filled).toBeGreaterThan(0)
    expect(filled).toBeLessThanOrEqual(fillable)

    const touched = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
        .filter((el) => {
          const kind = el.getAttribute("type")
          const sensitive =
            kind === "hidden" ||
            kind === "password" ||
            kind === "file" ||
            !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
          if (!sensitive) return false
          if (kind === "checkbox" || kind === "radio") return (el as HTMLInputElement).checked
          return el.value !== (kind === "hidden" ? "x" : "")
        })
        .map((el) => el.getAttribute("name") ?? el.id),
    )
    expect(touched).toEqual([])
    expect(page.url()).toBe(`${fixtureServer.origin}${path}`)
    expect(fixtureServer.submissions).toEqual([])
  })
}
