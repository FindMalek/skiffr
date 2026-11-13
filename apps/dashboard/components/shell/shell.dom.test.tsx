import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"

const nav = { pathname: "/queue", pushed: [] as string[] }
mock.module("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: (href: string) => nav.pushed.push(href) }),
}))

const { AppSidebar } = await import("@/components/app-sidebar")
const { PaletteProvider, SearchButton } = await import("./palette")
const { ShellProvider } = await import("./shell-provider")
const { SidebarTrigger } = await import("@skiffr/ui/components/sidebar")
const { TooltipProvider } = await import("@skiffr/ui/components/tooltip")
const { holdNavigation } = await import("@/lib/navigation-guard")
const { useActionBar } = await import("./use-action-bar")
const { RouteFocus, focusPageTitle } = await import("./route-focus")
const { TabBar } = await import("./tab-bar")

const network = (globalThis as { __network?: string[] }).__network ?? []
let root: Root
let host: HTMLElement

beforeEach(() => {
  nav.pathname = "/queue"
  nav.pushed.length = 0
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

test("a plain k, or Ctrl Shift K, never opens the palette: it must not hijack typing", async () => {
  await render(
    <PaletteProvider isAdmin={false}>
      <input aria-label="field" />
    </PaletteProvider>,
  )
  const press = (init: KeyboardEventInit) =>
    act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true, ...init }))
    })
  for (const init of [{}, { ctrlKey: true, shiftKey: true }, { metaKey: true, altKey: true }]) {
    await press(init)
    await wait(300)
    expect(dialog()).toBeNull()
  }
  await press({ metaKey: true })
  await wait(300)
  expect(dialog()).not.toBeNull()
})

test("Open next job opens its tab inside the click, before any request, and closes it when nothing opens", async () => {
  const tab = {
    closed: false,
    close() {
      this.closed = true
    },
  }
  const open = mock((..._args: unknown[]) => tab)
  window.open = open as unknown as typeof window.open
  await render(
    <PaletteProvider isAdmin={false}>
      <span />
    </PaletteProvider>,
  )
  await pressCtrlK()
  await wait(50)
  const item = [...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent === "Open next job")
  await act(async () => item?.dispatchEvent(new Event("click", { bubbles: true })))
  expect(open).toHaveBeenCalledTimes(1)
  expect(open.mock.calls[0]).toEqual(["about:blank", "_blank"])
  await wait(50)
  expect(tab.closed).toBe(true)
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

test("the rail and the full sidebar are both rendered and told apart by css, until the trigger pins one", async () => {
  await render(
    <TooltipProvider>
      <ShellProvider>
        <SidebarTrigger />
        <AppSidebar isAdmin />
      </ShellProvider>
    </TooltipProvider>,
  )
  const wrappers = () => [
    ...(host.querySelector('[data-slot="sidebar-wrapper"]')?.querySelectorAll<HTMLElement>(":scope > div") ?? []),
  ]
  const [full, rail] = wrappers()
  expect(full?.className).toBe("hidden xl:contents")
  expect(rail?.className).toBe("hidden md:contents xl:hidden")
  expect(full?.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state")).toBe("expanded")
  expect(rail?.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state")).toBe("collapsed")
  expect(host.querySelectorAll('[data-sidebar="rail"]')).toHaveLength(0)

  const wide = window.matchMedia("(min-width: 1280px)").matches
  await act(async () => host.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]')?.click())
  const [fullAfter, railAfter] = wrappers()
  expect(fullAfter?.className).toBe(wide ? "hidden" : "hidden md:contents")
  expect(railAfter?.className).toBe(wide ? "hidden md:contents" : "hidden")
})

test("after Try again the focus lands on the new page title, not on the body the button left behind", async () => {
  const page = (retried: boolean) => (
    <main id="main" tabIndex={-1}>
      {retried ? <h1 tabIndex={-1}>Stats</h1> : <button type="button">Try again</button>}
    </main>
  )
  await render(page(false))
  host.querySelector("button")?.focus()
  const stop = focusPageTitle()
  await render(page(true))
  await wait(50)
  expect(document.activeElement?.textContent).toBe("Stats")
  stop()
})

const selectItem = async (label: string) => {
  await pressCtrlK()
  await wait(50)
  const item = [...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent === label)
  await act(async () => item?.dispatchEvent(new Event("click", { bubbles: true })))
}

test("a page with unsaved edits holds the palette's navigation, like its links, and the palette closes first", async () => {
  await render(
    <PaletteProvider isAdmin={false}>
      <span />
    </PaletteProvider>,
  )
  const asked: string[] = []
  const release = holdNavigation((href) => {
    asked.push(href)
    return false
  })
  await selectItem("Queue")
  expect(asked).toEqual(["/queue"])
  expect(nav.pushed).toEqual([])
  await wait(300)
  expect(dialog()).toBeNull()

  release()
  await selectItem("Queue")
  expect(nav.pushed).toEqual(["/queue"])
})

test("a sticky bottom action reports its measured height to the shell and clears it when it goes", async () => {
  let measure: () => void = () => {}
  const observed = { disconnected: false }
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      measure = callback
    }
    observe() {}
    unobserve() {}
    disconnect() {
      observed.disconnected = true
    }
  } as unknown as typeof ResizeObserver
  let height = 61
  function Bar() {
    return <div ref={useActionBar()} />
  }
  await render(<Bar />)
  const bar = host.querySelector("div")
  if (!bar) throw new Error("no bar")
  bar.getBoundingClientRect = () => ({ height }) as DOMRect
  act(() => measure())
  expect(document.documentElement.style.getPropertyValue("--action-bar-h")).toBe("61px")
  height = 117
  act(() => measure())
  expect(document.documentElement.style.getPropertyValue("--action-bar-h")).toBe("117px")
  act(() => root.unmount())
  expect(document.documentElement.style.getPropertyValue("--action-bar-h")).toBe("")
  expect(observed.disconnected).toBe(true)
  root = createRoot(host)
})
