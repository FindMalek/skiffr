import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const nav = { pathname: "/settings/account", pushed: [] as string[] }
mock.module("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: (href: string) => nav.pushed.push(href) }),
}))

const { DEFAULT_RETURN } = await import("@skiffr/orpc/gmail")
const { SettingsNav } = await import("./settings-nav")
const { SETTINGS_ENTRIES, settingsEntryFor } = await import("./settings-routes")

let root: Root
let host: HTMLElement

beforeEach(() => {
  nav.pathname = "/settings/account"
  nav.pushed.length = 0
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = () => act(async () => root.render(<SettingsNav />))
const links = () => [...host.querySelectorAll("a")]

test("one labelled nav lists every settings page and marks only the current one", async () => {
  await render()
  expect(host.querySelectorAll('nav[aria-label="Settings"]')).toHaveLength(1)
  expect(links().map((link) => link.textContent)).toEqual([
    "Profile",
    "Account",
    "Extension",
    "Gmail alerts",
    "Careers pages",
    "Resume",
    "Data and privacy",
    "Appearance",
  ])
  const current = links().filter((link) => link.getAttribute("aria-current") === "page")
  expect(current.map((link) => link.getAttribute("href"))).toEqual(["/settings/account"])
  expect(host.querySelector('[aria-labelledby="settings-nav-job-sources"]')?.querySelectorAll("a")).toHaveLength(2)
})

test("a nested path keeps its parent entry current, an unknown one marks nothing", async () => {
  nav.pathname = "/settings/gmail/anything"
  await render()
  expect(links().find((link) => link.getAttribute("aria-current") === "page")?.textContent).toBe("Gmail alerts")
  act(() => root.unmount())
  root = createRoot(host)
  nav.pathname = "/settings/elsewhere"
  await render()
  expect(links().some((link) => link.hasAttribute("aria-current"))).toBe(false)
})

test("the gmail page stays at the path the oauth flow returns to, and every href is its own entry", () => {
  expect(SETTINGS_ENTRIES.some((entry) => entry.href === DEFAULT_RETURN)).toBe(true)
  expect(new Set(SETTINGS_ENTRIES.map((entry) => entry.href)).size).toBe(SETTINGS_ENTRIES.length)
  expect(settingsEntryFor("/settings/extension")?.label).toBe("Extension")
  expect(settingsEntryFor("/settings")).toBeUndefined()
})
