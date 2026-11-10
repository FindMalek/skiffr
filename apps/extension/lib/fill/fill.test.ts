import { describe, expect, test } from "bun:test"
import { mapFieldsInputSchema } from "@skiffr/common"
import { collectFields, descriptorBatches } from "./collect"
import { fillField } from "./fill-field"
import { fillPage } from "./fill-page"
import { mount, trusted } from "./test-dom"
import { watchEdits } from "./watch"

const el = <T extends HTMLElement>(doc: Document, sel: string) => doc.querySelector(sel) as T

describe("collectFields", () => {
  test("reads the label from every place a page puts one", () => {
    const { document } = mount(`
      <label for="a">Full name *</label><input id="a">
      <label>Email <input id="b" type="email"></label>
      <span id="lbl">Phone number</span><input id="c" aria-labelledby="lbl">
      <input id="d" aria-label="City">
      <div>Postal code</div><input id="e">
      <input id="f" placeholder="Street address">
      <input id="g" name="company_url">
    `)
    const labels = collectFields(document).map((f) => f.descriptor.label)
    expect(labels).toEqual(["Full name", "Email", "Phone number", "City", "Postal code", "Street address", undefined])
    expect(collectFields(document).at(-1)?.descriptor.name).toBe("company_url")
  })

  test("output passes the ai.mapFields input schema, with ids stable across passes", () => {
    const { document } = mount(`
      <fieldset><legend>Work authorization</legend>
        <label><input type="radio" name="auth" value="y"> Yes</label>
        <label><input type="radio" name="auth" value="n"> No</label>
      </fieldset>
      <label for="c">Country</label><select id="c"><option value="">Select</option><option>France</option><option>Germany</option></select>
    `)
    const first = collectFields(document)
    const [batch] = descriptorBatches(first)
    expect(mapFieldsInputSchema.parse({ fields: batch }).fields).toHaveLength(2)
    expect(batch?.[0]).toMatchObject({ label: "Work authorization", type: "radio", options: ["Yes", "No"] })
    expect(batch?.[1]).toMatchObject({ label: "Country", type: "select", options: ["France", "Germany"] })
    expect(collectFields(document).map((f) => f.id)).toEqual(first.map((f) => f.id))
  })

  test("skips honeypots, hidden and disabled controls but keeps a real website field", () => {
    const { document } = mount(`
      <input name="first" aria-label="First name">
      <input name="trap1" aria-label="Nickname" style="display:none">
      <div aria-hidden="true"><input name="trap2" aria-label="Fax"></div>
      <input name="trap3" aria-label="Phone 2" style="position:absolute;left:-9999px">
      <input name="website" tabindex="-1" autocomplete="off">
      <input name="trap5" aria-label="Zero" style="width:0;height:0">
      <input name="dis" aria-label="Disabled" disabled>
      <input name="ro" aria-label="Readonly" readonly>
      <input name="pw" type="password" aria-label="Password">
      <label for="site">Website</label><input id="site" name="website">
    `)
    expect(collectFields(document).map((f) => f.descriptor.label)).toEqual(["First name", "Website"])
  })

  test("finds inputs inside open shadow roots", () => {
    const { document } = mount(`<div id="host"></div>`)
    const shadow = el(document, "#host").attachShadow({ mode: "open" })
    shadow.innerHTML = `<label for="n">Nickname</label><input id="n">`
    expect(collectFields(document).map((f) => f.descriptor.label)).toEqual(["Nickname"])
  })
})

describe("fillField", () => {
  test("a controlled input that ignores plain .value writes still ends up with the value in its state", async () => {
    const { document } = mount(`<input id="x">`)
    const input = el<HTMLInputElement>(document, "#x")
    const state = { value: "" }
    let tracked = ""
    const proto = Object.getPrototypeOf(input)
    const native = Object.getOwnPropertyDescriptor(proto, "value") as PropertyDescriptor
    Object.defineProperty(input, "value", {
      get: () => native.get?.call(input),
      set: (v: string) => {
        tracked = v
        native.set?.call(input, v)
      },
    })
    input.addEventListener("input", () => {
      const current = native.get?.call(input) as string
      if (current === tracked) return
      tracked = current
      state.value = current
    })
    input.addEventListener("change", () => queueMicrotask(() => native.set?.call(input, state.value)))

    const result = await fillField(input, "Ada Lovelace")
    expect(state.value).toBe("Ada Lovelace")
    expect(result).toMatchObject({ status: "filled", value: "Ada Lovelace" })
  })

  test("reports failed when the page reverts the value", async () => {
    const { document } = mount(`<input id="x">`)
    const input = el<HTMLInputElement>(document, "#x")
    input.addEventListener("input", () => setTimeout(() => (input.value = ""), 0))
    expect((await fillField(input, "Ada")).status).toBe("failed")
  })

  test("typing fallback satisfies a mask that only reacts to keystrokes", async () => {
    const { document } = mount(`<input id="x" type="tel">`)
    const input = el<HTMLInputElement>(document, "#x")
    input.addEventListener("keydown", () => {
      ;(input as HTMLInputElement & { typed?: boolean }).typed = true
    })
    input.addEventListener("input", () => {
      if (!(input as HTMLInputElement & { typed?: boolean }).typed) input.value = ""
    })
    const result = await fillField(input, "5551234567")
    expect(result.status).toBe("filled")
  })

  test("select picks USA against United States and reports the option text", async () => {
    const { document } = mount(
      `<select id="c"><option value="">Choose</option><option value="DE">Germany</option><option value="US">United States of America</option></select>`,
    )
    const select = el<HTMLSelectElement>(document, "#c")
    expect(await fillField(select, "USA")).toMatchObject({ status: "filled", value: "United States of America" })
    expect(select.value).toBe("US")
    expect((await fillField(select, "us")).status).toBe("unchanged")
    expect((await fillField(select, "Atlantis")).status).toBe("failed")
  })

  test("radio group is set by clicking the matching option", async () => {
    const { document } = mount(`
      <label><input type="radio" name="s" value="1"> Yes, I need sponsorship</label>
      <label><input type="radio" name="s" value="0"> No, I do not</label>`)
    const [first] = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
    expect(await fillField(first as HTMLInputElement, "no")).toMatchObject({ status: "filled", value: "No, I do not" })
    expect(document.querySelector<HTMLInputElement>("[value='0']")?.checked).toBe(true)
  })

  test("checkbox group ticks every listed option and a lone box takes yes", async () => {
    const { document } = mount(`
      <fieldset><legend>Languages</legend>
        <label><input type="checkbox" name="l" value="en"> English</label>
        <label><input type="checkbox" name="l" value="fr"> French</label>
        <label><input type="checkbox" name="l" value="ar"> Arabic</label>
      </fieldset>
      <label><input type="checkbox" id="terms"> I agree</label>`)
    const [group] = collectFields(document)
    expect(await fillField(group?.el as HTMLElement, "English, Arabic")).toMatchObject({
      status: "filled",
      value: "English, Arabic",
    })
    expect(await fillField(el(document, "#terms"), "yes")).toMatchObject({ status: "filled", value: "true" })
  })

  test("custom combobox opens, picks the option and closes", async () => {
    const { document } = mount(`
      <label for="cb">Department</label>
      <input id="cb" role="combobox" aria-controls="lb" aria-expanded="false" autocomplete="off">
      <ul id="lb" role="listbox" hidden></ul>`)
    const input = el<HTMLInputElement>(document, "#cb")
    const list = el<HTMLUListElement>(document, "#lb")
    const choices = ["Engineering", "Design", "Sales"]
    input.addEventListener("click", () => {
      input.setAttribute("aria-expanded", "true")
      list.hidden = false
      list.innerHTML = choices.map((c) => `<li role="option">${c}</li>`).join("")
      for (const li of Array.from(list.children)) {
        li.addEventListener("click", () => {
          input.value = li.textContent ?? ""
          list.hidden = true
          input.setAttribute("aria-expanded", "false")
        })
      }
    })
    expect(await fillField(input, "engineering")).toMatchObject({ status: "filled", value: "Engineering" })
    expect(list.hidden).toBe(true)
  })

  test("date inputs take ISO from locale dates, day first when the page says so", async () => {
    const { document } = mount(`<input id="d" type="date"><input id="e" type="date">`)
    expect((await fillField(el(document, "#d"), "March 5, 2024")).value).toBe("2024-03-05")
    expect((await fillField(el(document, "#e"), "25/12/2024")).value).toBe("2024-12-25")
  })

  test("file input gets the resume through DataTransfer", async () => {
    const { document, window } = mount(`<label for="f">Resume</label><input id="f" type="file" accept=".pdf">`)
    const input = el<HTMLInputElement>(document, "#f")
    const File = window.File as unknown as typeof globalThis.File
    const pdf = new File(["%PDF"], "cv.pdf", { type: "application/pdf" })
    expect(await fillField(input, pdf)).toMatchObject({ status: "filled", value: "cv.pdf" })
    expect((await fillField(input, new File(["x"], "cv.docx"))).status).toBe("failed")
    expect((await fillField(input, "text")).status).toBe("skipped")
  })

  test("contenteditable gets its text", async () => {
    const { document } = mount(`<div id="e" contenteditable="true"></div>`)
    expect(await fillField(el(document, "#e"), "Hello there")).toMatchObject({ status: "filled", value: "Hello there" })
  })
})

describe("fillPage", () => {
  const html = `
    <label for="a">First name</label><input id="a">
    <label for="b">Last name</label><input id="b">
    <label for="c">Notes</label><input id="c" value="typed by me">
    <label for="d">Phone</label><input id="d">
    <label for="p">Password</label><input id="p" type="password">
    <label for="r">Resume</label><input id="r" type="file">
    <label for="o">Photo</label><input id="o" type="file">
    <button type="submit" id="go">Submit</button>`

  test("applies the mapping in order, leaves the rest alone and never submits", async () => {
    const { document } = mount(html)
    let submitted = false
    document.querySelector("#go")?.addEventListener("click", () => {
      submitted = true
    })
    const fields = collectFields(document)
    const id = (label: string) => fields.find((f) => f.descriptor.label === label)?.id as string
    const file = new (document.defaultView as never as { File: typeof File }).File(["x"], "cv.pdf", {
      type: "application/pdf",
    })
    const summary = await fillPage({
      root: document,
      mapping: [
        { id: id("First name"), action: "profile", key: "identity.firstName", confidence: 0.95, reason: "" },
        { id: id("Last name"), action: "profile", key: "identity.lastName", confidence: 0.4, reason: "" },
        { id: id("Notes"), action: "generate", value: "hello", confidence: 0.9, reason: "" },
        { id: id("Phone"), action: "skip", confidence: 0, reason: "sensitive" },
      ],
      values: { "identity.firstName": "Ada", "identity.lastName": "Lovelace" },
      files: { resume: file },
    })
    expect(summary.fields.map((f) => [f.label, f.status])).toEqual([
      ["First name", "filled"],
      ["Last name", "filled"],
      ["Notes", "skipped"],
      ["Phone", "skipped"],
      ["Resume", "filled"],
    ])
    expect(summary.counts).toEqual({ filled: 3, unchanged: 0, failed: 0, skipped: 2 })
    expect(el<HTMLInputElement>(document, "#c").value).toBe("typed by me")
    expect(el<HTMLInputElement>(document, "#p").value).toBe("")
    expect(el<HTMLInputElement>(document, "#o").files?.length ?? 0).toBe(0)
    expect(submitted).toBe(false)

    const last = el(document, "#b")
    expect(last.hasAttribute("data-skiffr-review")).toBe(true)
    expect(el(document, "#a").hasAttribute("data-skiffr-review")).toBe(false)
    summary.clearHighlights()
    expect(last.hasAttribute("data-skiffr-review")).toBe(false)
  })

  test("watchEdits reports trusted edits of filled fields only", async () => {
    const { document } = mount(`<label for="a">First name</label><input id="a">`)
    const [field] = collectFields(document)
    const summary = await fillPage({
      root: document,
      mapping: [{ id: field?.id as string, action: "profile", key: "k", confidence: 1, reason: "" }],
      values: { k: "Ada" },
    })
    const reports: unknown[] = []
    const stop = watchEdits(document, summary, (r) => reports.push(r))
    const input = el<HTMLInputElement>(document, "#a")
    input.value = "Adaa"
    input.dispatchEvent(
      new (document.defaultView as never as { Event: typeof Event }).Event("input", { bubbles: true }),
    )
    expect(reports).toEqual([])
    input.dispatchEvent(
      trusted(new (document.defaultView as never as { Event: typeof Event }).Event("change", { bubbles: true })),
    )
    expect(reports).toEqual([{ fieldId: field?.id, filledValue: "Ada", finalValue: "Adaa" }])
    stop()
  })
})
