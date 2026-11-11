import { expect, test } from "../fixtures/extension.ts"
import { ATS_PAGES, NEGATIVE_PAGES } from "../fixtures/pages.ts"
import { ToastDriver } from "../fixtures/toast.ts"

const SETTLE_MS = 2_500

for (const [name, page] of Object.entries(ATS_PAGES)) {
  test(`shows the toast on ${name}`, async ({ context, fixtureServer }) => {
    const tab = await context.newPage()
    await tab.goto(`${fixtureServer.origin}${page.path}`)
    await tab.bringToFront()
    const toast = await ToastDriver.attach(context, tab)

    const shown = await toast.waitFor((s) => s.buttons.some((b) => b.action === "yes"))

    expect(shown.buttons.map((b) => b.action)).toContain("yes")
  })
}

for (const [name, page] of Object.entries(NEGATIVE_PAGES)) {
  test(`stays silent on ${name}`, async ({ context, fixtureServer }) => {
    const tab = await context.newPage()
    await tab.goto(`${fixtureServer.origin}${page.path}`)
    await tab.bringToFront()
    const toast = await ToastDriver.attach(context, tab)

    await tab.waitForTimeout(SETTLE_MS)

    expect((await toast.snapshot()).buttons).toEqual([])
  })
}
