import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"

const nav = { pathname: "/queue" }
mock.module("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: () => {} }),
}))

const { PaletteProvider, SearchButton } = await import("./palette")
const { RouteFocus } = await import("./route-focus")
const { TabBar } = await import("./tab-bar")

const network = (globalThis as { __network?: string[] }).__network ?? []
let root: Root
let host: HTMLElement

beforeEach(() => {
  nav.pathname = "/queue"
  network.length = 0
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (node: ReactNode) =>
  act(async () => root.render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>))
const pressCtrlK = () =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }))
  })
const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))
const dialog = () => document.querySelector('[role="dialog"]')

test("Ctrl K opens the palette, Escape closes it, and nothing is fetched until you type two characters", async () => {
  await render(
    <PaletteProvider isAdmin={false}>
      <SearchButton />
    </PaletteProvider>,
  )
  expect(dialog()).toBeNull()
  expect(network).toEqual([])

  const trigger = document.querySelector<HTMLButtonElement>("button")
  trigger?.focus()
  await pressCtrlK()
  await wait(50)
  expect(dialog()).not.toBeNull()
  expect(document.querySelector("[cmdk-input]")).not.toBeNull()
  expect(network).toEqual([])

  const input = document.querySelector<HTMLInputElement>("[cmdk-input]")
  if (!input) throw new Error("no palette input")
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  const type = (value: string) =>
    act(async () => {
      set?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  await type("a")
  await wait(300)
  expect(network).toEqual([])
  await type("ac")
  await wait(300)
  expect(network.length).toBeGreaterThan(0)

  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  })
  await wait(300)
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test("the tab bar marks the current tab, and More opens the one sheet that holds settings", async () => {
  nav.pathname = "/answers"
  await render(<TabBar isAdmin={false} />)
  const bar = document.querySelector('nav[aria-label="Main"]')
  const labels = [...(bar?.querySelectorAll("a, button") ?? [])].map((el) => el.textContent)
  expect(labels).toEqual(["Today", "Queue", "Answers", "Stats", "More"])
  expect(bar?.querySelector('[aria-current="page"]')?.textContent).toBe("Answers")
  expect(dialog()).toBeNull()

  const more = [...(bar?.querySelectorAll("button") ?? [])].find((el) => el.textContent === "More")
  await act(async () => more?.click())
  await wait(50)
  const links = [...(dialog()?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))
  expect(links).toContain("/settings/appearance")
  expect(links).not.toContain("/users")
})

test("a route change moves focus to the page title, the first load does not", async () => {
  const page = (title: string) => (
    <>
      <RouteFocus />
      <main id="main" tabIndex={-1}>
        <h1 tabIndex={-1}>{title}</h1>
        <button type="button">Action</button>
      </main>
    </>
  )
  await render(page("Queue"))
  expect(document.activeElement).toBe(document.body)

  nav.pathname = "/answers"
  await render(page("Answers"))
  expect(document.activeElement?.tagName).toBe("H1")
  expect(document.activeElement?.textContent).toBe("Answers")
})
