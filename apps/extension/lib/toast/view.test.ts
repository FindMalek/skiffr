import { expect, test } from "bun:test"
import { Window } from "happy-dom"
import { createToastView } from "./view"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function setup() {
  const window = new Window({ url: "https://job-boards.greenhouse.io/acme/jobs/1" })
  const proto = window.HTMLElement.prototype as unknown as { attachShadow: (init: ShadowRootInit) => ShadowRoot }
  const original = proto.attachShadow
  proto.attachShadow = function (this: HTMLElement, init) {
    return original.call(this, { ...init, mode: "open" })
  }
  const doc = window.document as unknown as Document
  const calls: string[] = []
  const view = createToastView(doc, {
    onYes: () => calls.push("yes"),
    onNo: () => calls.push("no"),
    onNever: () => calls.push("never"),
    onTimeout: () => calls.push("timeout"),
    onSettings: () => calls.push("settings"),
    onRetry: () => calls.push("retry"),
  })
  return { window, doc, view, calls }
}

const hosts = (doc: Document) => [...doc.documentElement.children].filter((el) => el.shadowRoot)

test("the toast survives the page replacing its html element", async () => {
  const { doc, view } = setup()
  view.show()
  expect(hosts(doc)).toHaveLength(1)

  const next = doc.createElement("html")
  next.innerHTML = "<head></head><body><p>hydrated</p></body>"
  doc.documentElement.remove()
  doc.append(next)
  await wait(20)
  expect(doc.documentElement).toBe(next)
  expect(hosts(doc)).toHaveLength(1)
  view.hide()
  expect(hosts(doc)).toHaveLength(0)
})

test("the host does not use a fixed tag name", () => {
  const first = setup()
  first.view.show()
  const tag = hosts(first.doc)[0]?.tagName.toLowerCase() ?? ""
  expect(tag.startsWith("x-")).toBe(true)
  expect(tag).not.toContain("skiffr")
  first.view.hide()
})

test("synthetic clicks and keys from the page do nothing", () => {
  const { window, doc, view, calls } = setup()
  view.show()
  const root = hosts(doc)[0]?.shadowRoot
  root?.querySelector<HTMLElement>('[data-action="yes"]')?.click()
  const keydown = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  root?.querySelector(".toast")?.dispatchEvent(keydown as unknown as Event)
  expect(calls).toEqual([])
  view.hide()
})

const tick = () => wait(30)

test("a result replaces the question in place, announces in the live region and takes no focus", async () => {
  const { doc, view, calls } = setup()
  view.show()
  await tick()
  const root = hosts(doc)[0]?.shadowRoot
  const title = () => root?.querySelector(".title")
  expect(title()?.textContent).toBe("Autofill this application?")
  view.showMessage({ text: "Could not reach the API", actions: ["retry", "settings"] })
  expect(hosts(doc)).toHaveLength(1)
  expect(title()?.textContent).toBe("Could not reach the API")
  expect(title()?.getAttribute("aria-live")).toBe("polite")
  expect([...(root?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
    "Retry",
    "Open settings",
    "Close",
  ])
  expect(doc.activeElement).toBe(doc.body)
  expect(calls).toEqual([])
  view.hide()
})

test("a result shown on its own keeps its text and closes itself", async () => {
  const { doc, view } = setup()
  view.showMessage({ text: "Filling your application…", busy: true })
  await tick()
  const root = hosts(doc)[0]?.shadowRoot
  expect(root?.querySelector(".title")?.textContent).toBe("Filling your application…")
  expect(root?.querySelectorAll("button")).toHaveLength(0)
  view.showMessage({ text: "Filled 2 fields" })
  expect(root?.querySelector(".title")?.textContent).toBe("Filled 2 fields")
  expect([...(root?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual(["Close"])
  view.hide()
  expect(hosts(doc)).toHaveLength(0)
})

test("the toast asks again after a result was closed", async () => {
  const { doc, view } = setup()
  view.showMessage({ text: "Nothing to fill" })
  view.hide()
  view.show()
  await tick()
  expect(hosts(doc)[0]?.shadowRoot?.querySelector(".title")?.textContent).toBe("Autofill this application?")
  view.hide()
})

test("after a keyboard answer the result takes the focus the question had, a mouse answer does not", async () => {
  const { window, doc, view } = setup()
  view.show()
  await tick()
  const root = hosts(doc)[0]?.shadowRoot
  const click = (detail: number) => {
    const event = new window.MouseEvent("click", { bubbles: true, detail })
    Object.defineProperty(event, "isTrusted", { value: true })
    root?.querySelector('[data-action="yes"]')?.dispatchEvent(event as unknown as Event)
  }
  click(0)
  view.hide()
  view.showMessage({ text: "Filling…", busy: true })
  const toast = () => hosts(doc)[0]?.shadowRoot?.querySelector(".toast")
  expect(hosts(doc)[0]?.shadowRoot?.activeElement).toBe(toast() ?? null)
  view.hide()

  view.show()
  await tick()
  const root2 = hosts(doc)[0]?.shadowRoot
  const mouse = new window.MouseEvent("click", { bubbles: true, detail: 1 })
  Object.defineProperty(mouse, "isTrusted", { value: true })
  root2?.querySelector('[data-action="yes"]')?.dispatchEvent(mouse as unknown as Event)
  view.hide()
  view.showMessage({ text: "Filling…", busy: true })
  expect(hosts(doc)[0]?.shadowRoot?.activeElement ?? null).toBeNull()
  view.hide()
})
