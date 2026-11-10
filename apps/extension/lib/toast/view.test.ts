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
