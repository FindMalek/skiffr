import { expect, test } from "bun:test"

const { default: config } = await import("./next.config")
const { default: SettingsPage } = await import("./app/(app)/settings/page")

test("the old extension url redirects permanently to the settings page", async () => {
  const redirects = (await config.redirects?.()) ?? []
  expect(redirects).toContainEqual({ source: "/extension", destination: "/settings/extension", permanent: true })
})

test("trailing slash variants are normalised by next, so the one source covers /extension/", () => {
  expect(config.trailingSlash).not.toBe(true)
})

test("/settings sends the visitor to the account page", () => {
  let thrown: unknown
  try {
    SettingsPage()
  } catch (error) {
    thrown = error
  }
  const digest = (thrown as { digest?: string } | undefined)?.digest ?? ""
  expect(digest).toStartWith("NEXT_REDIRECT;")
  expect(digest).toContain("/settings/account")
})
