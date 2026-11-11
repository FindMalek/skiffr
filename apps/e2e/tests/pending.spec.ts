import { test } from "../fixtures/extension.ts"
import { ATS_PAGES, NEGATIVE_PAGES } from "../fixtures/pages.ts"

test.describe("detect and toast (#45)", () => {
  for (const [name, page] of Object.entries(ATS_PAGES)) {
    test.fixme(`shows the toast on ${name}`, async ({ context, fixtureServer }) => {
      const tab = await context.newPage()
      await test.step(`open ${page.path}`, () => tab.goto(`${fixtureServer.origin}${page.path}`))
      await test.step("the toast appears once the application form is detected", async () => {})
      await test.step("the toast offers the fill action", async () => {})
    })
  }

  for (const [name, page] of Object.entries(NEGATIVE_PAGES)) {
    test.fixme(`stays silent on ${name}`, async ({ context, fixtureServer }) => {
      const tab = await context.newPage()
      await test.step(`open ${page.path}`, () => tab.goto(`${fixtureServer.origin}${page.path}`))
      await test.step("no toast appears after the page settles", async () => {})
    })
  }

  test.fixme("detects the form inside a cross-origin iframe", async ({ context, fixtureServer }) => {
    const tab = await context.newPage()
    await test.step("open the page embedding a form from the alt origin", () =>
      tab.goto(`${fixtureServer.origin}/ats/embedded.html`))
    await test.step("the content script runs in the subframe (all_frames)", async () => {})
    await test.step("the toast appears for the embedded form", async () => {})
  })
})

test.describe("fill engine (#48)", () => {
  test.fixme("fills profile fields from the api and never submits", async ({ context, fixtureServer, mockApi }) => {
    const tab = await context.newPage()
    await test.step("save the mock api url and token in the options page", async () => {})
    await test.step(`open ${ATS_PAGES.greenhouse.path}`, () =>
      tab.goto(`${fixtureServer.origin}${ATS_PAGES.greenhouse.path}`))
    await test.step("trigger fill", async () => {})
    await test.step("name, email, phone and links hold the profile values", async () => {})
    await test.step("the mock api received one authorized map-fields request", async () => {
      void mockApi.requests
    })
    await test.step("the fixture server saw no submission", async () => {
      void fixtureServer.submissions
    })
  })

  test.fixme("fills a react-controlled input so its state updates", async () => {})
})

test.describe("learning (#49)", () => {
  test.fixme("reuses a corrected answer on the next form", async () => {
    await test.step("fill a form and change one field by hand", async () => {})
    await test.step("open a second ats page with the same question", async () => {})
    await test.step("the second form is filled with the corrected answer", async () => {})
  })
})

test.describe("fill shortcut (#32)", () => {
  test.fixme("the fill command reaches the active tab", async () => {
    await test.step("dispatch commands.onCommand with the fill command", async () => {})
    await test.step("the content script on the active tab receives the fill message", async () => {})
    await test.step("the badge stays empty when a receiver exists and shows ! when none does", async () => {})
  })
})
