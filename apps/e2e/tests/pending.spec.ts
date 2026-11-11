import { test } from "../fixtures/extension.ts"
import { ATS_PAGES, NEGATIVE_PAGES } from "../fixtures/pages.ts"

// Each spec below needs a feature that has not landed. Remove the fixme and fill the body when it does.

test.describe("detect (#4)", () => {
  for (const [name, page] of Object.entries(ATS_PAGES)) {
    test.fixme(`shows the toast on ${name}`, async ({ context, fixtureServer }) => {
      const tab = await context.newPage()
      await tab.goto(`${fixtureServer.origin}${page.path}`)
    })
  }

  for (const [name, page] of Object.entries(NEGATIVE_PAGES)) {
    test.fixme(`stays silent on ${name}`, async ({ context, fixtureServer }) => {
      const tab = await context.newPage()
      await tab.goto(`${fixtureServer.origin}${page.path}`)
    })
  }

  test.fixme("detects the form inside a cross-origin iframe", async () => {
    // needs `all_frames` on the content script
  })
})

test.describe("fill (#5)", () => {
  test.fixme("fills profile fields from the mock api and never submits", async ({ fixtureServer, mockApi }) => {
    void fixtureServer.submissions
    void mockApi.requests
  })

  test.fixme("learns a corrected field and reuses it on the next form", async () => {})
})

test.describe("fill shortcut (#32)", () => {
  test.fixme("the fill command reaches the active tab", async () => {
    // chrome has no public way to fire commands.onCommand from a test
  })
})
