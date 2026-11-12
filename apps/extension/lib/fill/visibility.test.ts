import { describe, expect, test } from "bun:test"
import { mount } from "./test-dom"
import { isVisible, newVisibilityCtx } from "./visibility"

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect

/** happy-dom has no layout: give the page a size and make `hit` what a point on the field lands on. */
function page(html: string, hitSelector: string) {
  const { document, $ } = mount(html)
  Object.defineProperty(document.documentElement, "clientWidth", { value: 1280 })
  const field = $<HTMLInputElement>("#first")
  field.getBoundingClientRect = () => rect(20, 300, 400, 40)
  const hit = $<HTMLElement>(hitSelector)
  document.elementFromPoint = () => hit
  return { field, isShown: () => isVisible(field, newVisibilityCtx()) }
}

const FIELD = `<label for="first">First name</label><input id="first">`
const COOKIE = `<div role="dialog" aria-modal="true" aria-label="Cookie Consent"><span id="words">We use cookies</span><button>Decline all</button></div>`

describe("a field behind a dialog", () => {
  test("is reachable behind a cookie dialog and the dimmed backdrop next to it", () => {
    const backdrop = page(`${FIELD}<div><div id="back"></div>${COOKIE}</div>`, "#back")
    expect(backdrop.isShown()).toBe(true)
    const text = page(`${FIELD}<div><div id="back"></div>${COOKIE}</div>`, "#words")
    expect(text.isShown()).toBe(true)
  })

  test("is not reachable behind any other dialog, or a cookie dialog nobody can answer or see", () => {
    const other = `<div role="dialog" aria-modal="true" aria-label="Add education"><button>Save</button></div>`
    expect(page(`${FIELD}<div><div id="back"></div>${other}</div>`, "#back").isShown()).toBe(false)
    const mute = `<div role="dialog" aria-label="Cookie Consent"><span>We use cookies</span></div>`
    expect(page(`${FIELD}<div><div id="back"></div>${mute}</div>`, "#back").isShown()).toBe(false)
    const clear = page(`${FIELD}<div><div id="back" style="opacity:0"></div>${COOKIE}</div>`, "#back")
    expect(clear.isShown()).toBe(false)
  })

  test("is not reachable behind a plain box that only sits next to a cookie dialog", () => {
    const loud = page(`${FIELD}<div><p id="ad">Win a prize</p>${COOKIE}</div>`, "#ad")
    expect(loud.isShown()).toBe(false)
  })
})
