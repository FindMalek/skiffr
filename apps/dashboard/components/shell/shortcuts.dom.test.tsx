import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"

const nav = { pushed: [] as string[] }
mock.module("next/navigation", () => ({
  usePathname: () => "/queue",
  useRouter: () => ({ push: (href: string) => nav.pushed.push(href) }),
}))

const { PaletteProvider } = await import("./palette")
const { ShellProvider } = await import("./shell-provider")
const { ShortcutsProvider, useShortcut } = await import("./shortcuts")
const { UserMenu } = await import("./user-menu")
const { SidebarTrigger } = await import("@skiffr/ui/components/sidebar")
const { TooltipProvider } = await import("@skiffr/ui/components/tooltip")
const { holdNavigation } = await import("@/lib/navigation-guard")
const { SHORTCUTS_STORAGE_KEY, writeShortcutsEnabled } = await import("@/lib/shortcuts-setting")

let root: Root
let host: HTMLElement

beforeEach(() => {
  window.localStorage.clear()
  nav.pushed.length = 0
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  writeShortcutsEnabled(true)
  window.localStorage.clear()
})

const render = (node: ReactNode) =>
  act(async () => root.render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>))
const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))
const press = (target: Element | Window, key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
  })
const dialog = () => document.querySelector('[role="dialog"]')
const input = () => host.querySelector("input") as HTMLInputElement
const button = () => host.querySelector("main button") as HTMLButtonElement

function Probe({ onRun, keys = ["n"] }: { onRun: () => void; keys?: string[] }) {
  useShortcut({ id: "probe", keys, label: "Open next job", group: "Queue", run: onRun })
  return null
}

const page = (children?: ReactNode) => (
  <PaletteProvider isAdmin={false}>
    <ShortcutsProvider>
      <main id="main" tabIndex={-1}>
        <button type="button">Action</button>
        <input aria-label="field" />
      </main>
      {children}
    </ShortcutsProvider>
  </PaletteProvider>
)

test("? opens the help dialog with what pages registered, and closing it returns focus to where it was", async () => {
  const runs: string[] = []
  await render(page(<Probe onRun={() => runs.push("n")} />))
  button().focus()
  await press(button(), "?")
  await wait(50)
  expect(dialog()?.textContent).toContain("Keyboard shortcuts")
  const rows = [...(dialog()?.querySelectorAll("dl > div") ?? [])].map((row) => row.textContent)
  expect(rows).toContain("Open next jobn")
  expect(rows).toContain("Todaygthenh")
  expect(rows).toContain("Show this list?")
  expect(dialog()?.querySelectorAll("h3")).toHaveLength(4)

  // The only tab stop is the close button: Tab must stay on it, not walk out into the page behind.
  const close = dialog()?.querySelector<HTMLElement>("button")
  close?.focus()
  for (const shiftKey of [false, true]) {
    const tab = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true })
    await act(async () => close?.dispatchEvent(tab))
    expect(tab.defaultPrevented).toBe(true)
  }

  await press(document.activeElement as Element, "Escape")
  await wait(300)
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(button())
})

test("g then q goes to the queue, unless the page holds navigation for unsaved edits", async () => {
  await render(page())
  await press(button(), "g")
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Queue")
  await press(button(), "q")
  expect(nav.pushed).toEqual(["/queue"])
  expect(document.querySelector('[role="status"]')?.textContent).toBe("")

  const release = holdNavigation(() => false)
  await press(button(), "g")
  await press(button(), "a")
  expect(nav.pushed).toEqual(["/queue"])
  release()
})

test("typing a shortcut into a field does nothing, so a search for 'queue' never leaves the page", async () => {
  const runs: string[] = []
  await render(page(<Probe onRun={() => runs.push("n")} />))
  input().focus()
  for (const key of ["g", "q", "n", "?"]) await press(input(), key)
  expect(runs).toEqual([])
  expect(nav.pushed).toEqual([])
  expect(dialog()).toBeNull()
})

test("with the switch off no single key fires, while Cmd/Ctrl K and Esc still work", async () => {
  const runs: string[] = []
  await render(page(<Probe onRun={() => runs.push("n")} />))
  await act(async () => writeShortcutsEnabled(false))
  expect(window.localStorage.getItem(SHORTCUTS_STORAGE_KEY)).toBe("off")
  for (const key of ["n", "?"]) await press(button(), key)
  await press(button(), "g")
  await press(button(), "q")
  expect(runs).toEqual([])
  expect(nav.pushed).toEqual([])
  expect(dialog()).toBeNull()

  await press(window, "k", { ctrlKey: true })
  await wait(300)
  expect(dialog()).not.toBeNull()
  await press(document.activeElement as Element, "Escape")
  await wait(300)
  expect(dialog()).toBeNull()
})

test("a shortcut stops firing once the component that registered it is gone", async () => {
  const runs: string[] = []
  await render(page(<Probe onRun={() => runs.push("n")} />))
  await press(button(), "n")
  expect(runs).toEqual(["n"])
  await render(page())
  await press(button(), "n")
  expect(runs).toEqual(["n"])
})

test("the user menu opens the help dialog even with shortcuts off, and focus goes back to the menu button", async () => {
  await render(
    <TooltipProvider>
      {page(<UserMenu me={{ name: "Ana", email: "ana@test.dev", image: null, role: null }} />)}
    </TooltipProvider>,
  )
  await act(async () => writeShortcutsEnabled(false))
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label^="Account menu"]')
  trigger?.focus()
  await act(async () => trigger?.click())
  await wait(50)
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent === "Keyboard shortcuts",
  )
  expect(item).not.toBeUndefined()
  expect(item?.hasAttribute("aria-keyshortcuts")).toBe(false)
  await act(async () => item?.click())
  await wait(100)
  expect(dialog()?.textContent).toContain("Single key shortcuts are off in this browser")
  expect(dialog()?.querySelector('a[href="/settings/appearance"]')).not.toBeNull()
  const headings = [...(dialog()?.querySelectorAll("h3") ?? [])].map((heading) => heading.textContent)
  expect(headings).toEqual(["Anywhere", "Go to (off)", "On the page (off)"])
  const sidebarRow = [...(dialog()?.querySelectorAll("dl > div") ?? [])].find((row) =>
    row.textContent?.includes("sidebar"),
  )
  expect(sidebarRow?.className).toContain("max-md:hidden")

  await press(document.activeElement as Element, "Escape")
  await wait(300)
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test("Ctrl B toggles the sidebar, but not while typing in a field", async () => {
  await render(
    <TooltipProvider>
      <ShellProvider>
        <SidebarTrigger />
        <input aria-label="field" />
      </ShellProvider>
    </TooltipProvider>,
  )
  const expanded = () => host.querySelector('[data-sidebar="trigger"]')?.getAttribute("aria-expanded")
  const before = expanded()
  await press(input(), "b", { ctrlKey: true })
  expect(expanded()).toBe(before)
  await press(host.querySelector("button") as Element, "b", { ctrlKey: true })
  expect(expanded()).not.toBe(before)
})

test("a page that registers the shell's own keys wins on the first mount and after a later one", async () => {
  const runs: string[] = []
  await render(page(<Probe keys={["g", "q"]} onRun={() => runs.push("page")} />))
  await press(button(), "g")
  await press(button(), "q")
  expect(runs).toEqual(["page"])
  expect(nav.pushed).toEqual([])

  await render(page())
  await press(button(), "g")
  await press(button(), "q")
  expect(nav.pushed).toEqual(["/queue"])
  await render(page(<Probe keys={["g", "q"]} onRun={() => runs.push("page")} />))
  await press(button(), "g")
  await press(button(), "q")
  expect(runs).toEqual(["page", "page"])
  expect(nav.pushed).toEqual(["/queue"])
})

test("g, then focus leaving the page and coming back, does not leave a sequence waiting", async () => {
  await render(
    page(
      <a href="/stats" id="side">
        side
      </a>,
    ),
  )
  const chip = () => document.querySelector('[role="status"]')?.textContent
  await press(button(), "g")
  expect(chip()).toContain("Queue")
  button().focus()
  await act(async () => {
    const side = document.getElementById("side")
    button().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: side }))
    side?.focus()
  })
  expect(chip()).toBe("")
  button().focus()
  await press(button(), "q")
  expect(nav.pushed).toEqual([])
})

test("turning the switch off drops a sequence that is waiting", async () => {
  await render(page())
  await press(button(), "g")
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Queue")
  await act(async () => writeShortcutsEnabled(false))
  expect(document.querySelector('[role="status"]')?.textContent).toBe("")
})

test("the provider takes its document listeners off when it unmounts", async () => {
  const add: string[] = []
  const remove: string[] = []
  const realAdd = document.addEventListener.bind(document)
  const realRemove = document.removeEventListener.bind(document)
  document.addEventListener = ((type: string, ...rest: unknown[]) => {
    add.push(type)
    return (realAdd as (...args: unknown[]) => void)(type, ...rest)
  }) as typeof document.addEventListener
  document.removeEventListener = ((type: string, ...rest: unknown[]) => {
    remove.push(type)
    return (realRemove as (...args: unknown[]) => void)(type, ...rest)
  }) as typeof document.removeEventListener
  try {
    await render(page())
    await act(async () => root.unmount())
    root = createRoot(host)
  } finally {
    document.addEventListener = realAdd
    document.removeEventListener = realRemove
  }
  for (const type of ["keydown", "focusout"]) {
    expect(add).toContain(type)
    expect(remove.filter((removed) => removed === type)).toHaveLength(add.filter((added) => added === type).length)
  }
})

test("shortcuts work on a fresh load, with nothing focused", async () => {
  const runs: string[] = []
  await render(page(<Probe onRun={() => runs.push("n")} />))
  expect(document.activeElement).toBe(document.body)
  await press(document.body, "n")
  expect(runs).toEqual(["n"])
})

test("if the element that had focus is gone when the dialog closes, focus goes to the page, not the body", async () => {
  await render(page())
  button().focus()
  await press(button(), "?")
  await wait(100)
  await act(async () => button().remove())
  await press(document.activeElement as Element, "Escape")
  await wait(300)
  expect(dialog()).toBeNull()

  expect(document.activeElement?.id).toBe("main")
})
