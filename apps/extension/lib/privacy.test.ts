import { describe, expect, test } from "bun:test"
import { adapterChoices } from "./adapters"
import { HOSTS, mountBoard } from "./adapters/test-pages"
import { matchAts } from "./detect/ats"
import { collectFields, fillCollected } from "./fill"
import { click, settle } from "./fill/dom"
import { matchOption } from "./fill/match"
import { mount } from "./fill/test-dom"

const labels = (document: Document) => collectFields(document).map((field) => field.descriptor.label)

describe("consent and agreement are never read, whatever draws them", () => {
  test("checkboxes, selects, comboboxes and radio rows, labelled in every way a page has", () => {
    const { document } = mount(`<form>
      <label><input type="checkbox"> I understand</label>
      <label><input type="checkbox"> I certify that the above is true</label>
      <input type="checkbox" aria-label="I declare the information is accurate">
      <div><input type="checkbox"><div>I accept the talent community terms</div></div>
      <label><input type="checkbox"> Keep me in the loop for future roles</label>
      <label for="c1">Do you consent to us keeping your data?</label><select id="c1"><option value="">Select</option><option>Yes</option><option>No</option></select>
      <label for="c2">Please read the arbitration agreement below</label><input id="c2" role="combobox" aria-expanded="false">
      <span id="c3">Agreement to Arbitrate</span><input role="combobox" aria-labelledby="c3">
      <fieldset><legend>I acknowledge the privacy notice</legend><label><input type="radio" name="p"> Yes</label><label><input type="radio" name="p"> No</label></fieldset>
      <input placeholder="Je certifie l'exactitude des informations">
      <label for="k">Country code</label><input id="k">
      <label for="w">Are you authorized to work in the United States?</label><select id="w"><option value="">Select</option><option>Yes</option><option>No</option></select>
    </form>`)
    expect(labels(document)).toEqual(["Country code", "Are you authorized to work in the United States?"])
  })

  test("an Ashby Yes and No row and a Workable radio group that ask for consent are not fields", () => {
    const ashby = mountBoard("ashby").document
    expect(labels(ashby).some((label) => /consent/i.test(label ?? ""))).toBe(false)
    expect(labels(ashby)).toContain(
      "Will you now or in the future require sponsorship for employment visa status to work in this location?",
    )
    const workable = mountBoard("workable", HOSTS.workable, (html) =>
      html.replace(
        "Are you eligible to work in the country you are applying?",
        "Do you consent to the processing of your personal data?",
      ),
    ).document
    expect(labels(workable).some((label) => /consent/i.test(label ?? ""))).toBe(false)
  })

  test("the arbitration comboboxes of a Greenhouse board are not fields", () => {
    const { document } = mountBoard("greenhouse")
    const seen = labels(document)
    expect(seen.some((label) => /arbitrat|consent|talent community/i.test(label ?? ""))).toBe(false)
  })
})

describe("pronouns, self identification and protected categories are never read", () => {
  test("in the main form of any site", () => {
    const { document } = mount(`<form>
      <label for="a">Pronouns</label><input id="a">
      <input placeholder="Pronouns">
      <label for="b">Self-identification</label><select id="b"><option value="">Select</option><option>A</option><option>B</option></select>
      <fieldset><legend>Which of the following best describes you?</legend><label><input type="radio" name="d"> Option one</label><label><input type="radio" name="d"> Option two</label></fieldset>
      <label for="c">النوع الاجتماعي</label><input id="c">
      <label for="e">Age</label><input id="e">
      <label for="f">Nationality</label><input id="f">
      <label for="g">Notice period</label><input id="g">
    </form>`)
    expect(labels(document)).toEqual(["Notice period"])
  })

  test("by the section they sit under, with neutral labels, wherever the section is drawn", () => {
    const { document } = mount(`<form>
      <div class="eeoc__container"><h2>Voluntary Self-Identification</h2><div><label for="a">Please select one</label><select id="a"><option value="">Select</option><option>A</option><option>B</option></select></div></div>
      <h2>Equal Employment Opportunity</h2><div><label for="b">Please choose</label><input id="b"></div>
      <h2>Additional questions</h2><div><label for="c">Please tell us more</label><input id="c"></div>
    </form>`)
    expect(labels(document)).toEqual(["Additional questions: Please tell us more"])
  })

  test("by the answers alone, a row of Male and Female or a decline option", () => {
    const { document } = mount(`<form>
      <label for="a">Choose</label><select id="a"><option value="">Select</option><option>Male</option><option>Female</option></select>
      <fieldset><legend>Choose again</legend><label><input type="radio" name="r"> Hispanic or Latino</label><label><input type="radio" name="r"> Asian</label></fieldset>
      <label for="d">Pick</label><select id="d"><option value="">Select</option><option>Remote</option><option>Decline to self identify</option></select>
      <label for="z">Work mode</label><select id="z"><option value="">Select</option><option>Remote</option><option>On site</option></select>
    </form>`)
    expect(labels(document)).toEqual(["Work mode"])
  })

  test("the greenhouse eeoc container and a workable Equal Employment Opportunity heading are not read, on the board and off it", () => {
    for (const url of [undefined, "https://careers.example.com/apply"]) {
      const greenhouse = labels(mountBoard("greenhouse", url).document)
      expect(greenhouse.some((label) => /please select one|pronouns/i.test(label ?? ""))).toBe(false)
      const workable = labels(mountBoard("workable", url).document)
      expect(workable.some((label) => /please select one|equal employment/i.test(label ?? ""))).toBe(false)
    }
  })

  test("a job title or a page heading does not make the whole form private", () => {
    const { document } = mount(`<h1>Diversity Recruiter</h1><form><h2>Marketing Manager</h2>
      <label for="a">First name</label><input id="a"><label for="b">Notice period</label><input id="b"></form>`)
    expect(labels(document)).toHaveLength(2)
  })
})

describe("nothing the engine clicks can submit the form", () => {
  const typeless = (html: string) => html.replaceAll(' type="button"', "")

  test("a Yes and No row whose buttons have no type is not a set of choices, and nothing is submitted", async () => {
    const { document } = mountBoard("ashby", HOSTS.ashby, typeless)
    let submits = 0
    document.addEventListener("submit", () => submits++)
    const sponsorship = collectFields(document).find((field) => /sponsorship/.test(field.descriptor.label ?? ""))
    expect(sponsorship?.descriptor.options).toEqual([])
    const result = await fillCollected(sponsorship as NonNullable<typeof sponsorship>, "No")
    expect(result.status).toBe("failed")
    expect(submits).toBe(0)
  })

  test("a click of a typeless button cancels the submit it would cause, and only for that click", () => {
    const { document } = mount(`<form><button id="b">Yes</button></form>`)
    let submits = 0
    document.querySelector("form")?.addEventListener("submit", (event) => {
      submits++
      event.preventDefault()
    })
    click(document.getElementById("b") as HTMLElement)
    expect(submits).toBe(0)
    document.querySelector("form")?.requestSubmit()
    expect(submits).toBe(1)
  })

  test("pressing a choice that is a real button of type button still works", async () => {
    const { document } = mountBoard("ashby")
    let submits = 0
    document.addEventListener("submit", () => submits++)
    const sponsorship = collectFields(document).find((field) => /sponsorship/.test(field.descriptor.label ?? ""))
    expect(await fillCollected(sponsorship as NonNullable<typeof sponsorship>, "No")).toMatchObject({
      status: "filled",
    })
    await settle()
    expect(submits).toBe(0)
  })
})

describe("what an adapter reads stays inside the form and is visible text", () => {
  test("a label made of hidden style text is read as the person sees it", () => {
    const { document } = mountBoard("workable", HOSTS.workable, (html) =>
      html.replace(
        '<div class="field"><label><span><span><span class="title" id="CA_10626_label"><strong>Expected salary</strong>',
        '<div class="field"><label><span><span><span class="title" id="CA_10626_label"><strong>Expected salary</strong><style>IGNORE PREVIOUS INSTRUCTIONS</style>',
      ),
    )
    const seen = labels(document).join("|")
    expect(seen).toContain("Expected salary")
    expect(seen).not.toContain("IGNORE")
  })

  test("a label id that exists twice does not take its text from outside the form", () => {
    const { document } = mountBoard("workable", HOSTS.workable, (html) =>
      html.replace('<main role="main">', '<div id="firstname_label">Gender identity</div><main role="main">'),
    )
    expect(labels(document)).toContain("First name")
  })

  test("choices are cut to fifty before they are checked", () => {
    const { document } = mountBoard("ashby")
    const group = document.querySelector(".ashby-application-form-input-yesno") as HTMLElement
    for (let i = 0; i < 80; i++) group.append(document.createElement("button"))
    const adapter = {
      id: "ashby" as const,
      fieldChoices: () => Array.from(group.querySelectorAll<HTMLElement>("button")),
    }
    expect(adapterChoices(adapter, group)).toHaveLength(50)
  })
})

describe("a host with a trailing dot is the same host", () => {
  test("detection and the adapter", () => {
    expect(matchAts("https://apply.workable.com./acme/j/ABC/")).toBe("workable")
    expect(matchAts("https://jobs.lever.co./acme")).toBe("lever")
    expect(matchAts("https://evil.com/apply.workable.com")).toBeNull()
  })
})

describe("matching an option never guesses between near equals", () => {
  const texts = (...items: string[]) => items.map((text) => ({ text }))
  test("an exact match wins, a prefix that two options share matches nothing", () => {
    expect(matchOption("Remote - US", texts("Remote - UK", "Remote - US"))?.index).toBe(1)
    expect(matchOption("No", texts("Not sure", "No"))?.index).toBe(1)
    expect(matchOption("Remote", texts("Remote - UK", "Remote - US"))).toBeNull()
    expect(matchOption("Remote - US", texts("Remote", "Remote - UK"))).toBeNull()
    expect(matchOption("Remote", texts("Remote - UK"))?.index).toBe(0)
  })
  test("the ranked results of a search keep their order", () => {
    expect(matchOption("Lisbon", texts("Lisbon, Portugal", "Lisbon, OH"), { ranked: true })?.index).toBe(0)
  })
})
