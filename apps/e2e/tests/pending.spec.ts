import { test } from "../fixtures/extension.ts"
import { EMBEDDED_PAGE } from "../fixtures/pages.ts"

test.describe("detect and toast (#45)", () => {
  test.fixme("detects the form inside a cross-origin iframe", async ({ context, fixtureServer }) => {
    const tab = await context.newPage()
    await test.step("open the page embedding a form from the alt origin", () =>
      tab.goto(`${fixtureServer.origin}${EMBEDDED_PAGE.path}`))
    await test.step("the content script runs in the subframe (all_frames)", async () => {})
    await test.step("the toast appears for the embedded form", async () => {})
  })
})

test.describe("fill engine (#48)", () => {
  test.fixme("fills a react-controlled input so its state updates", async () => {})
})

test.describe("fill shortcut (#32)", () => {
  test.fixme("the fill command reaches the active tab", async () => {
    await test.step("dispatch commands.onCommand with the fill command", async () => {})
    await test.step("the content script on the active tab receives the fill message", async () => {})
    await test.step("the badge stays empty when a receiver exists and shows ! when none does", async () => {})
  })
})
