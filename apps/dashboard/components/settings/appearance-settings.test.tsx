import { afterEach, beforeEach, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { SHORTCUTS_STORAGE_KEY } from "@/lib/shortcuts-setting"
import { AppearanceSettings } from "./appearance-settings"

let root: Root
let host: HTMLElement

beforeEach(() => {
  window.localStorage.clear()
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })) as unknown as typeof window.matchMedia
  }
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.className = ""
})

const render = () =>
  act(async () =>
    root.render(
      <ThemeProvider>
        <AppearanceSettings />
      </ThemeProvider>,
    ),
  )

test("choosing a theme applies it to the page and keeps it for the next visit", async () => {
  await render()
  const dark = [...host.querySelectorAll<HTMLElement>('[role="radio"]')].find((radio) => radio.textContent === "Dark")
  expect(dark).not.toBeNull()
  await act(async () => dark?.click())
  expect(document.documentElement.classList.contains("dark")).toBe(true)
  expect(window.localStorage.getItem("theme")).toBe("dark")
  expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Dark")
})

test("the shortcuts switch starts on and writes the browser setting", async () => {
  await render()
  const toggle = host.querySelector<HTMLElement>('[role="switch"]')
  expect(toggle?.getAttribute("aria-checked")).toBe("true")
  await act(async () => toggle?.click())
  expect(window.localStorage.getItem(SHORTCUTS_STORAGE_KEY)).toBe("off")
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
  expect(host.textContent).toContain("Off in this browser.")
})

test("the switch follows a change made in another tab", async () => {
  await render()
  window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, "off")
  await act(async () => {
    window.dispatchEvent(new StorageEvent("storage", { key: SHORTCUTS_STORAGE_KEY }))
  })
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
})

test("the switch has one stable name and the state is only its description", async () => {
  await render()
  const toggle = host.querySelector('[role="switch"]')
  const label = host.querySelector("label")
  expect(label?.textContent).toBe("Single key shortcuts")
  expect(document.getElementById(toggle?.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
    "On in this browser.",
  )
})
