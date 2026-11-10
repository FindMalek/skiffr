import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Window } from "happy-dom"
import { matchAts } from "./ats"
import { detectApplicationForm } from "./score"

const FIXTURES = join(import.meta.dir, "../../test/fixtures")

function detect(fixture: string, url: string) {
  const window = new Window({ url })
  window.document.write(readFileSync(join(FIXTURES, `${fixture}.html`), "utf8"))
  return detectApplicationForm(window.document as unknown as Document, url)
}

test.each([
  ["greenhouse", "https://job-boards.greenhouse.io/acme/jobs/1", "greenhouse"],
  ["lever", "https://jobs.lever.co/acme/abc/apply", "lever"],
  ["ashby", "https://jobs.ashbyhq.com/acme/abc/application", "ashby"],
  ["workable", "https://apply.workable.com/acme/j/ABC/apply/", "workable"],
])("%s application form is detected with its ats", (fixture, url, ats) => {
  const result = detect(fixture, url)
  expect(result.isForm).toBe(true)
  expect(result.ats).toBe(ats as typeof result.ats)
  expect(result.confidence).toBeGreaterThan(0.6)
})

test("a generic careers form is detected from structure alone", () => {
  const result = detect("careers-generic", "https://initech.example/careers/apply")
  expect(result.isForm).toBe(true)
  expect(result.ats).toBeNull()
})

test.each([
  ["newsletter", "https://acme.example/blog"],
  ["login", "https://acme.example/careers/login"],
  ["search", "https://acme.example/jobs"],
  ["checkout", "https://shop.example/checkout"],
])("%s page is not an application form", (fixture, url) => {
  const result = detect(fixture, url)
  expect(result.isForm).toBe(false)
  expect(result.reasons.length).toBeGreaterThan(0)
})

test("an ats listing page without inputs is not a form", () => {
  const window = new Window({ url: "https://jobs.lever.co/acme" })
  window.document.write("<h1>Open roles</h1><a href='/1'>Designer</a>")
  const result = detectApplicationForm(window.document as unknown as Document, "https://jobs.lever.co/acme")
  expect(result).toMatchObject({ isForm: false, ats: "lever", confidence: 0 })
})

test("hidden controls do not count", () => {
  const window = new Window({ url: "https://initech.example/careers" })
  window.document.write(
    `<title>Careers</title><form><input name="full_name"><input type="email"><div style="display:none"><input type="tel"></div><input type="text" style="display:none"></form>`,
  )
  expect(detectApplicationForm(window.document as unknown as Document, "https://initech.example/careers").isForm).toBe(
    false,
  )
})

test("ats host matching", () => {
  expect(matchAts("https://acme.wd5.myworkdayjobs.com/en-US/External/job/x")).toBe("workday")
  expect(matchAts("https://acme.bamboohr.com/careers/12")).toBe("bamboohr")
  expect(matchAts("https://acme.bamboohr.com/login")).toBeNull()
  expect(matchAts("https://www.linkedin.com/jobs/view/1")).toBe("linkedin")
  expect(matchAts("https://www.linkedin.com/feed/")).toBeNull()
  expect(matchAts("https://notgreenhouse.io/")).toBeNull()
  expect(matchAts("chrome://extensions")).toBeNull()
})

test("linkedin counts only with the easy apply dialog", () => {
  const url = "https://www.linkedin.com/jobs/view/1"
  const window = new Window({ url })
  window.document.write(
    `<div role="dialog" class="jobs-easy-apply-modal"><form>
      <label for="e">Email address</label><select id="e"><option>a@b.c</option></select>
      <label for="c">Phone country code</label><select id="c"><option>US</option></select>
      <label for="p">Mobile phone number</label><input id="p"></form></div>`,
  )
  const result = detectApplicationForm(window.document as unknown as Document, url)
  expect(result).toMatchObject({ isForm: true, ats: "linkedin" })
})
