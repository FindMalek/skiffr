import { describe, expect, test } from "bun:test"
import { mapFieldsInputSchema } from "@skiffr/common"
import { collectFields, descriptorBatches } from "./collect"
import { fillField } from "./fill-field"
import { fillPage } from "./fill-page"
import { readField } from "./read"
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
    expect(last.style.getPropertyValue("outline")).toContain("solid")
    expect(last.style.getPropertyPriority("outline")).toBe("important")
    expect(el(document, "#a").style.getPropertyValue("outline")).toBe("")
    summary.clearHighlights()
    expect(last.style.getPropertyValue("outline")).toBe("")
  })

  test("watchEdits needs a trusted gesture on the field, and stays quiet while the engine fills", async () => {
    const { document, window } = mount(`<label for="a">First name</label><input id="a">`)
    const [field] = collectFields(document)
    const mapping = [{ id: field?.id as string, action: "profile" as const, key: "k", confidence: 1, reason: "" }]
    const summary = await fillPage({ root: document, mapping, values: { k: "Ada" } })
    const reports: unknown[] = []
    const stop = watchEdits(document, summary, (r) => reports.push(r))
    const input = el<HTMLInputElement>(document, "#a")
    const fire = (type: string, isTrusted = true) => {
      const event = new (window as never as { Event: typeof Event }).Event(type, { bubbles: true })
      input.dispatchEvent(isTrusted ? trusted(event) : event)
    }

    input.value = "Adaa"
    fire("input", false)
    fire("change")
    fire("focusout")
    expect(reports).toEqual([])

    fire("keydown", false)
    fire("change")
    expect(reports).toEqual([])

    fire("keydown")
    fire("change")
    expect(reports).toEqual([{ fieldId: field?.id, filledValue: "Ada", finalValue: "Adaa" }])

    input.value = "Zed"
    fire("keydown")
    const refill = fillPage({ root: document, mapping, values: { k: "Ada" }, overwrite: true })
    fire("change")
    await refill
    expect(reports).toHaveLength(1)
    stop()
  })
})

describe("labels and sections", () => {
  test("the section is folded into the label and twins are marked ambiguous", () => {
    const { document } = mount(`
      <section aria-label="Applicant"><label for="a">Name</label><input id="a" name="name"></section>
      <h3>Reference</h3><div><label for="b">Name</label><input id="b" name="name"></div>
      <div><label for="c">Title</label><input id="c" name="title"></div><div><label for="d">Title</label><input id="d" name="title"></div>`)
    const fields = collectFields(document)
    expect(fields.map((f) => f.descriptor.label)).toEqual([
      "Applicant: Name",
      "Reference: Name",
      "Reference: Title",
      "Reference: Title",
    ])
    expect(fields.map((f) => f.info.ambiguous)).toEqual([undefined, undefined, true, true])
  })

  test("required markers are stripped and text nodes keep a space between them", () => {
    const { document } = mount(`
      <label><div>Full name<span>\u2731</span></div><input name="n"></label>
      <label><span>First name</span><span>Last name</span><input name="m"></label>`)
    expect(collectFields(document).map((f) => f.descriptor.label)).toEqual(["Full name", "First name Last name"])
  })
})

describe("adapting values", () => {
  const field = async (html: string, value: string, locale?: string) => {
    const { document } = mount(html)
    const input = el<HTMLInputElement>(document, "input")
    const before = input.value
    const result = await fillField(input, value, { locale })
    return { result, input, before }
  }

  test("email, url and tel are never cut to maxlength", async () => {
    for (const [html, value] of [
      [`<input type="email" maxlength="10">`, "test.applicant@example.com"],
      [`<input type="url" maxlength="10">`, "https://example.com/very/long"],
      [`<input type="tel" maxlength="10">`, "+1 (000) 000-0000"],
    ] as const) {
      const { result, input } = await field(html, value)
      expect(result.status).toBe("failed")
      expect(result.reason).toContain("max length")
      expect(input.value).toBe("")
    }
  })

  test("numbers only parse when their separators are unambiguous", async () => {
    expect((await field(`<input type="number">`, "85.000,50")).result).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("ambiguous"),
    })
    expect((await field(`<input type="number">`, "120,000")).result.status).toBe("failed")
    expect((await field(`<input type="number">`, "1,5")).input.value).toBe("1.5")
    expect((await field(`<input type="number">`, "$85000")).input.value).toBe("85000")
    expect((await field(`<input type="number">`, "85.000,50", "de-DE")).input.value).toBe("85000.50")
  })

  test("a date whose order is unknown fails, an explicit locale decides", async () => {
    expect((await field(`<input type="date">`, "03/04/2025")).result).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("ambiguous"),
    })
    expect((await field(`<input type="date">`, "03/04/2025", "en-GB")).input.value).toBe("2025-04-03")
    expect((await field(`<input type="date">`, "2025-04-03")).input.value).toBe("2025-04-03")
  })

  test("a value the page rejects is put back", async () => {
    const { document } = mount(`<input id="x" value="keep me">`)
    const input = el<HTMLInputElement>(document, "#x")
    input.addEventListener("input", () => {
      if (input.value.startsWith("Ada")) setTimeout(() => (input.value = "page says no"), 0)
    })
    const result = await fillField(input, "Ada")
    expect(result.status).toBe("failed")
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(input.value).toBe("keep me")
  })
})

describe("selects, comboboxes and slots", () => {
  test("a prompt option is not a choice and a chosen select is protected", async () => {
    const { document } = mount(`
      <label for="a">Country</label><select id="a"><option value="0">Select one</option><option>Canada</option><option>United States</option></select>
      <label for="b">Region</label><select id="b"><option>Canada</option><option selected>Quebec</option></select>`)
    const fields = collectFields(document)
    expect(fields[0]?.descriptor.options).toEqual(["Canada", "United States"])
    const summary = await fillPage({
      root: document,
      mapping: fields.map((f) => ({
        id: f.id,
        action: "generate" as const,
        value: f.descriptor.label === "Country" ? "usa" : "Canada",
        confidence: 1,
        reason: "",
      })),
      values: {},
    })
    expect(summary.fields.map((f) => [f.label, f.status])).toEqual([
      ["Country", "filled"],
      ["Region", "skipped"],
    ])
    expect(el<HTMLSelectElement>(document, "#b").value).toBe("Quebec")
  })

  test("a combobox never picks an option of an unrelated listbox", async () => {
    const { document } = mount(`
      <label for="cb">Department</label><input id="cb" role="combobox" autocomplete="off">
      <div role="listbox" id="other"><div role="option">Engineering</div></div>`)
    let clicked = false
    document.querySelector("[role=option]")?.addEventListener("click", () => {
      clicked = true
    })
    const result = await fillField(el(document, "#cb"), "Engineering")
    expect(result.status).toBe("failed")
    expect(clicked).toBe(false)
  })

  test("a combobox picks from a menu inserted when it opens, linked or not", async () => {
    const { document } = mount(`<label for="cb">Department</label><input id="cb" role="combobox" autocomplete="off">`)
    const input = el<HTMLInputElement>(document, "#cb")
    input.addEventListener("click", () => {
      const menu = document.createElement("div")
      menu.innerHTML = `<div role="option">Design</div><div role="option">Engineering</div>`
      document.body.append(menu)
      for (const option of Array.from(menu.children)) {
        option.addEventListener("click", () => {
          input.value = option.textContent ?? ""
          menu.remove()
        })
      }
    })
    expect(await fillField(input, "engineering")).toMatchObject({ status: "filled", value: "Engineering" })
  })

  test("a react-select style widget is read from the sibling value node", async () => {
    const { document } = mount(`
      <div><label for="g">T-shirt size</label><div><div class="select__control"><div class="select__value-container">
        <div class="select__single-value">Large</div><div><input id="g" role="combobox" value=""></div></div></div></div></div>`)
    const [field] = collectFields(document)
    expect(readField(field as never)).toBe("Large")
  })

  test("the resume goes to the input that says resume, never to a photo or cover letter slot", async () => {
    const { document, window } = mount(`
      <div data-ui="photo"><input type="file"></div>
      <div data-ui="cover-letter"><input type="file"></div>
      <div data-ui="resume"><input type="file"></div>`)
    const file = new (window.File as never as typeof File)(["x"], "cv.pdf")
    const summary = await fillPage({ root: document, mapping: [], values: {}, files: { resume: file } })
    expect(summary.fields).toHaveLength(1)
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("input")).map((i) => i.files?.length ?? 0)).toEqual([
      0, 0, 1,
    ])
  })

  test("a lone upload with no name is the resume, a lone photo upload is not", async () => {
    for (const [html, expected] of [
      [`<div><input type="file"></div>`, 1],
      [`<div class="avatar-upload"><input type="file"></div>`, 0],
    ] as const) {
      const { document, window } = mount(html)
      const file = new (window.File as never as typeof File)(["x"], "cv.pdf")
      await fillPage({ root: document, mapping: [], values: {}, files: { resume: file } })
      expect(document.querySelector<HTMLInputElement>("input")?.files?.length ?? 0).toBe(expected)
    }
  })

  test("an editor that reverts the text is reported failed and left as it was", async () => {
    const { document } = mount(`<div id="e" contenteditable="true">draft</div>`)
    const editor = el(document, "#e")
    let beforeinput = 0
    editor.addEventListener("beforeinput", () => beforeinput++)
    editor.addEventListener("input", () => setTimeout(() => (editor.textContent = "draft"), 0))
    const result = await fillField(editor, "Hello")
    expect(beforeinput).toBe(1)
    expect(result.status).toBe("failed")
    expect(editor.textContent).toBe("draft")
  })
})
