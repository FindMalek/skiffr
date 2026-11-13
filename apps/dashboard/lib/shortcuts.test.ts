import { afterEach, beforeEach, expect, test } from "bun:test"
import { createShortcuts, type Shortcut, type Shortcuts } from "./shortcuts"

let main: HTMLElement
let enabled = true
let shortcuts: Shortcuts
const calls: string[] = []

const shortcut = (id: string, keys: string[], extra: Partial<Shortcut> = {}): Shortcut => ({
  id,
  keys,
  label: id,
  group: "Test",
  run: () => calls.push(id),
  ...extra,
})
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  enabled = true
  calls.length = 0
  document.body.innerHTML =
    '<aside><a href="/x" id="nav">nav</a></aside><main id="main" tabindex="-1"><button id="b">b</button></main>'
  main = document.getElementById("main") as HTMLElement
  shortcuts = createShortcuts({ isEnabled: () => enabled, timeoutMs: 40 })
  document.addEventListener("keydown", shortcuts.handle)
})

afterEach(() => {
  document.removeEventListener("keydown", shortcuts.handle)
  document.body.innerHTML = ""
})

const on = (tag: string, attrs: Record<string, string> = {}) => {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  main.append(el)
  return el
}

test("a shortcut fires on the page and never while typing", () => {
  shortcuts.register(shortcut("help", ["?"]))
  const button = document.getElementById("b") as HTMLElement
  expect(press(button, "?")).toBe(false)
  expect(calls).toEqual(["help"])

  const typing = [
    on("input", { type: "text" }),
    on("input", { type: "search" }),
    on("textarea"),
    on("select"),
    on("div", { contenteditable: "true" }),
    on("div", { role: "combobox" }),
  ]
  for (const field of typing) press(field, "?")
  const inner = document.createElement("span")
  typing[4]?.append(inner)
  press(inner, "?")
  expect(calls).toEqual(["help"])

  // A checkbox or a button is not typing: a row's checkbox must not block list shortcuts.
  press(on("input", { type: "checkbox" }), "?")
  expect(calls).toEqual(["help", "help"])
})

test("with shortcuts off nothing fires and a sequence in progress is dropped", () => {
  shortcuts.register(shortcut("help", ["?"]))
  shortcuts.register(shortcut("queue", ["g", "q"]))
  const button = document.getElementById("b") as HTMLElement
  press(button, "g")
  expect(shortcuts.pending()?.typed).toEqual(["g"])
  enabled = false
  press(button, "q")
  press(button, "?")
  expect(calls).toEqual([])
  expect(shortcuts.pending()).toBeNull()
  enabled = true
  press(button, "q")
  expect(calls).toEqual([])
})

test("modified keys, held keys and keys outside the page content never fire", () => {
  shortcuts.register(shortcut("help", ["?"]))
  shortcuts.register(shortcut("queue", ["g", "q"]))
  shortcuts.register(shortcut("go", ["j"]))
  const button = document.getElementById("b") as HTMLElement
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }])
    press(button, "j", init)
  press(button, "J", { shiftKey: true })
  press(document.getElementById("nav") as Element, "?")
  press(document.body, "j")
  expect(calls).toEqual([])
  press(button, "g")
  press(button, "q", { ctrlKey: true })
  expect(shortcuts.pending()).toBeNull()
  press(button, "q")
  expect(calls).toEqual([])
})

test("a sequence completes in order and is dropped after the timeout or a wrong key", async () => {
  shortcuts.register(shortcut("queue", ["g", "q"]))
  shortcuts.register(shortcut("answers", ["g", "a"]))
  const button = document.getElementById("b") as HTMLElement

  press(button, "g")
  expect(shortcuts.pending()?.next.map((next) => next.id)).toEqual(["answers", "queue"])
  press(button, "Shift")
  press(button, "q")
  expect(calls).toEqual(["queue"])
  expect(shortcuts.pending()).toBeNull()

  press(button, "g")
  await wait(80)
  expect(shortcuts.pending()).toBeNull()
  press(button, "q")
  expect(calls).toEqual(["queue"])

  press(button, "g")
  press(button, "x")
  press(button, "q")
  expect(calls).toEqual(["queue"])
})

test("a sequence only finishes where it started: moving focus out of the page drops it", () => {
  shortcuts.register(shortcut("queue", ["g", "q"]))
  press(document.getElementById("b") as Element, "g")
  press(document.getElementById("nav") as Element, "q")
  expect(calls).toEqual([])
  expect(shortcuts.pending()).toBeNull()
})

test("an open dialog or menu keeps the page shortcuts quiet", () => {
  shortcuts.register(shortcut("help", ["?"]))
  const dialog = document.createElement("div")
  dialog.setAttribute("role", "dialog")
  document.body.append(dialog)
  press(document.getElementById("b") as Element, "?")
  expect(calls).toEqual([])
  dialog.remove()
  press(document.getElementById("b") as Element, "?")
  expect(calls).toEqual(["help"])
})

test("list shortcuts need focus inside a list, and an unregistered shortcut stops firing", () => {
  const off = shortcuts.register(shortcut("next", ["j"], { scope: "list" }))
  const button = document.getElementById("b") as HTMLElement
  press(button, "j")
  expect(calls).toEqual([])
  const list = on("div", { "data-shortcuts-list": "" })
  const row = document.createElement("button")
  list.append(row)
  press(row, "j")
  expect(calls).toEqual(["next"])

  off()
  expect(shortcuts.list()).toEqual([])
  press(row, "j")
  expect(calls).toEqual(["next"])
})

test("a later registration of the same keys wins and the earlier one is back when it leaves", () => {
  shortcuts.register(shortcut("shell", ["n"]))
  const off = shortcuts.register(shortcut("page", ["n"]))
  const button = document.getElementById("b") as HTMLElement
  press(button, "n")
  off()
  press(button, "n")
  expect(calls).toEqual(["page", "shell"])
})

test("a handler another listener already used is not run twice", () => {
  shortcuts.register(shortcut("help", ["?"]))
  const button = document.getElementById("b") as HTMLElement
  button.addEventListener("keydown", (event) => event.preventDefault())
  press(button, "?")
  expect(calls).toEqual([])
})
