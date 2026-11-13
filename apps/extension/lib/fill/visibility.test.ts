import { describe, expect, test } from "bun:test"
import { mount } from "./test-dom"
import { isVisible, newVisibilityCtx } from "./visibility"

const FULL = `data-box="0 0 1024 768"`
const FIXED = "position:fixed;"

/** happy-dom has no layout: boxes come from `data-box="left top width height"`. */
function layout(window: { HTMLElement: { prototype: object } }, document: Document): void {
  Object.defineProperty(document.documentElement, "clientWidth", { value: 1024 })
  ;(window.HTMLElement.prototype as { getBoundingClientRect: unknown }).getBoundingClientRect = function (
    this: HTMLElement,
  ) {
    const [left = 0, top = 0, width = 0, height = 0] = (this.getAttribute("data-box") ?? "").split(" ").map(Number)
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect
  }
}

/** `layers` are the boxes in front of the field, top first: what `elementsFromPoint` gives, ending with the field. */
function page(html: string, ...layers: string[]) {
  const { window, document, $ } = mount(html)
  layout(window, document)
  const stack = [...layers, "#first"].map((selector) => $<HTMLElement>(selector))
  document.elementFromPoint = () => stack[0] ?? null
  document.elementsFromPoint = () => stack
  return { isShown: () => isVisible($("#first"), newVisibilityCtx()) }
}

const FIELD = `<label for="first">First name</label><input id="first" data-box="20 300 400 40">`
const COOKIE = `role="dialog" aria-label="Cookie Consent"`
const BUTTON = `<button>Decline all</button>`
const dialog = (style = FIXED, attrs = COOKIE, inner = `<span id="words">We use cookies</span>${BUTTON}`) =>
  `<div ${attrs} style="${style}bottom:0" data-box="0 700 1024 68">${inner}</div>`
const backdrop = (style = FIXED) => `<div id="back" style="${style}opacity:.95" ${FULL}></div>`
const DLG = "[role=dialog]"
const modal = (back = backdrop(), box = dialog()) => `${FIELD}<div>${back}${box}</div>`

describe("a field behind a cookie dialog", () => {
  test("is reachable behind the dimmed backdrop of a fixed cookie dialog, and behind the dialog itself", () => {
    expect(page(modal(), "#back").isShown()).toBe(true)
    expect(page(modal(), "#words", DLG, "#back").isShown()).toBe(true)
  })

  test("is not reachable behind a plain box, or a dimmed backdrop with no dialog next to it", () => {
    expect(page(`${FIELD}<div id="back" style="background:#fff" ${FULL}></div>`, "#back").isShown()).toBe(false)
    expect(page(`${FIELD}<div>${backdrop()}</div>`, "#back").isShown()).toBe(false)
  })
})

describe("a page that fakes a cookie dialog over a field", () => {
  const box = `id="back" style="position:absolute;background:#fff;" data-box="0 290 1024 50"`
  const fakeDialog = (extra = "") => `<div ${COOKIE} ${box} ${extra}>${BUTTON}</div>`

  test("an opaque box named like a cookie dialog with a button does not open the field", () => {
    expect(page(`${FIELD}${fakeDialog()}`, "#back").isShown()).toBe(false)
  })

  test("a nearly transparent box does not", () => {
    const faded = `<div ${COOKIE} id="back" style="position:absolute;opacity:.01;" data-box="0 290 1024 50">${BUTTON}</div>`
    expect(page(`${FIELD}${faded}`, "#back").isShown()).toBe(false)
  })

  test("a box that only says aria-modal and gdpr, with no dialog role, does not", () => {
    const text = `<div aria-modal="true" id="gdpr" ${box.replace('id="back" ', "")}>${BUTTON}</div>`
    expect(page(`${FIELD}${text}`, "#gdpr").isShown()).toBe(false)
    const dimmed = modal(backdrop(), dialog(FIXED, `aria-modal="true" id="gdpr"`))
    expect(page(dimmed, "#back").isShown()).toBe(false)
  })

  test("an empty opaque box with a tiny dialog next to it does not", () => {
    const tiny = `<div role="dialog" aria-label="cookie settings" style="position:fixed;width:10px;height:10px" data-box="0 0 10 10">${BUTTON}</div>`
    const html = `${FIELD}<div><div id="back" style="position:absolute;background:#fff;" data-box="0 290 1024 50"></div>${tiny}</div>`
    expect(page(html, "#back").isShown()).toBe(false)
  })

  test("a fixed box that does not span the viewport does not, even beside a fixed cookie dialog", () => {
    const small = `<div id="back" style="position:fixed;opacity:1" data-box="0 290 1024 50"></div>`
    expect(page(modal(small), "#back").isShown()).toBe(false)
  })

  test("a backdrop that is faded out, hidden or lets the pointer through does not", () => {
    for (const style of ["opacity:.01;", "visibility:hidden;", "pointer-events:none;"]) {
      const faint = `<div id="back" style="${FIXED}${style}" ${FULL}></div>`
      expect(page(modal(faint), "#back").isShown()).toBe(false)
    }
    const dimmedWrapper = `<div style="opacity:.01">${backdrop()}</div>`
    expect(page(`${FIELD}<div>${dimmedWrapper}${dialog()}</div>`, "#back").isShown()).toBe(false)
  })

  test("a backdrop with a fixed dialog that is not named like a cookie dialog does not", () => {
    const other = modal(backdrop(), dialog(FIXED, `role="dialog" aria-label="Add education"`))
    expect(page(other, "#back").isShown()).toBe(false)
  })

  test("a dialog without a button, or one that is not fixed, does not", () => {
    expect(page(modal(backdrop(), dialog(FIXED, COOKIE, "<span>We use cookies</span>")), "#back").isShown()).toBe(false)
    expect(page(modal(backdrop(), dialog("position:absolute;")), "#back").isShown()).toBe(false)
    expect(page(modal(backdrop(), dialog("position:absolute;")), "#words", DLG, "#back").isShown()).toBe(false)
  })

  test("content of another dialog in front of the field does not, whatever dims the page", () => {
    const education = dialog(
      FIXED,
      `role="dialog" aria-label="Add education"`,
      `<span id="words">School</span>${BUTTON}`,
    )
    expect(page(modal(backdrop(), education), "#words", DLG, "#back").isShown()).toBe(false)
  })

  test("a fake in an open shadow root does not", () => {
    const { window, document, $ } = mount(FIELD)
    const host = document.createElement("div")
    document.body.append(host)
    const root = host.attachShadow({ mode: "open" })
    root.innerHTML = `<div id="back" ${COOKIE} style="position:absolute;background:#fff" data-box="0 290 1024 50">${BUTTON}</div>`
    layout(window, document)
    const stack = [root.getElementById("back") as HTMLElement, $("#first")]
    document.elementFromPoint = () => stack[0] ?? null
    document.elementsFromPoint = () => stack
    expect(isVisible($("#first"), newVisibilityCtx())).toBe(false)
  })
})

describe("a plain cover under a cookie layer", () => {
  const cover = `<div id="cover" style="position:absolute;background:#fff;" data-box="0 290 1024 50"></div>`
  const covered = (back = backdrop(), box = dialog()) => `${FIELD}${cover}<div>${back}${box}</div>`

  test("still hides the field: the cookie layers are looked through, the cover is not", () => {
    expect(page(covered(), "#back", "#cover").isShown()).toBe(false)
    expect(page(covered(), "#words", DLG, "#cover").isShown()).toBe(false)
    expect(page(covered(), "#words", DLG, "#back", "#cover").isShown()).toBe(false)
  })

  test("is not in the way when nothing but the field is below the cookie layers", () => {
    expect(page(modal(), "#words", DLG, "#back").isShown()).toBe(true)
  })

  test("two stacked backdrops are both looked through, and a cover under them still counts", () => {
    const stacked = `${backdrop()}<div id="back2" style="${FIXED}opacity:.9" ${FULL}></div>`
    expect(page(modal(stacked), DLG, "#back2", "#back").isShown()).toBe(true)
    expect(page(`${FIELD}${cover}<div>${stacked}${dialog()}</div>`, DLG, "#back2", "#back", "#cover").isShown()).toBe(
      false,
    )
  })
})

describe("what makes a layer a cookie layer", () => {
  test("every part of the backdrop is needed: opacity of its ancestors, its width, being fixed, being empty", () => {
    const faded = `<div style="opacity:.3">${backdrop()}${dialog()}</div>`
    expect(page(`${FIELD}${faded}`, "#back").isShown()).toBe(false)
    const narrow = `<div id="back" style="${FIXED}opacity:.95" data-box="0 0 400 768"></div>`
    expect(page(modal(narrow), "#back").isShown()).toBe(false)
    expect(page(modal(backdrop("position:absolute;")), "#back").isShown()).toBe(false)
    const texty = `<div id="back" style="${FIXED}opacity:.95" ${FULL}>Accept to continue</div>`
    expect(page(modal(texty), "#back").isShown()).toBe(false)
  })

  test("a hit inside the dialog needs the dimmed backdrop beside it and a button in it", () => {
    expect(page(`${FIELD}<div>${dialog()}</div>`, "#words", DLG).isShown()).toBe(false)
    const mute = dialog(FIXED, COOKIE, `<span id="words">We use cookies</span>`)
    expect(page(modal(backdrop(), mute), "#words", DLG).isShown()).toBe(false)
  })
})
