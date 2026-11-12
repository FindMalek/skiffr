import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Window } from "happy-dom"
import { isTrustedFrameUrl, matchAts, offerScope, siteKey } from "./ats"
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
  ["jobs-contact", "https://acme.example/jobs/contact"],
  ["loan-application", "https://bank.example/loans/application"],
  ["application-support", "https://acme.example/support/application"],
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

function detectHtml(html: string, url: string) {
  const window = new Window({ url })
  window.document.write(html)
  return detectApplicationForm(window.document as unknown as Document, url)
}

test("free text application questions never read as payment fields", () => {
  const html = `<h1>Product Engineer</h1><form>
    <label for="n">Name</label><input id="n" name="_systemfield_name">
    <label for="e">Email</label><input id="e" type="email">
    <label id="r">Resume</label><input type="file" aria-labelledby="r">
    <label for="q">Describe a choice you made when shipping a product that traded speed for quality</label><textarea id="q"></textarea>
    <label for="b">How have you handled billing and payment disputes before?</label><input id="b" type="text">
    <button type="submit">Submit Application</button></form>`
  expect(detectHtml(html, "https://jobs.ashbyhq.com/acme/1/application")).toMatchObject({ isForm: true, ats: "ashby" })
})

test("structured card fields still block the group", () => {
  const card = `<form><input name="full_name"><input type="email"><input type="tel"><input type="text" autocomplete="cc-number"></form>`
  const named = `<form><input name="full_name"><input type="email"><input type="tel"><input name="card_number"></form>`
  const labelled = `<form><input name="full_name"><input type="email"><input type="tel"><label>Card number<input type="text"></label></form>`
  for (const html of [card, named, labelled]) {
    expect(detectHtml(`<h1>Apply</h1>${html}`, "https://jobs.ashbyhq.com/acme/1").isForm).toBe(false)
  }
})

test("a page with thousands of inputs is skipped instead of analysed", () => {
  const inputs = Array.from({ length: 6000 }, (_, i) => `<input name="f${i}">`).join("")
  const html = `<h1>Apply</h1><form><input name="full_name"><input type="email"><input type="tel">${inputs}</form>`
  const result = detectHtml(html, "https://jobs.lever.co/acme/1/apply")
  expect(result.isForm).toBe(false)
  expect(result.reasons.join(" ")).toContain("too many controls")
})

test("a form revealed from a hidden panel on a custom domain is detected", () => {
  const url = "https://careers.initech.example/jobs/designer"
  const window = new Window({ url })
  window.document.write(readFileSync(join(FIXTURES, "teamtailor-apply-click.html"), "utf8"))
  const doc = window.document as unknown as Document
  window.document.getElementById("panel")?.removeAttribute("hidden")
  expect(detectApplicationForm(doc, url)).toMatchObject({ isForm: true, ats: null })
})

test("site key separates companies on multi tenant ats hosts only", () => {
  expect(siteKey("https://job-boards.greenhouse.io/Anthropic/jobs/1")).toBe("job-boards.greenhouse.io/anthropic")
  expect(siteKey("https://jobs.ashbyhq.com/acme/abc/application")).toBe("jobs.ashbyhq.com/acme")
  expect(siteKey("https://jobs.lever.co/acme/1")).toBe("jobs.lever.co/acme")
  expect(siteKey("https://acme.wd1.myworkdayjobs.com/en-US/careers")).toBe("acme.wd1.myworkdayjobs.com")
  expect(siteKey("https://careers.initech.example/jobs/1")).toBe("careers.initech.example")
  expect(siteKey("not a url")).toBeNull()
})

test("child frames are trusted only on the top origin or a known ats host", () => {
  const top = "https://initech.example/careers"
  expect(isTrustedFrameUrl(top, "https://initech.example/embed")).toBe(true)
  expect(isTrustedFrameUrl(top, "https://job-boards.greenhouse.io/initech/jobs/1")).toBe(true)
  expect(isTrustedFrameUrl(top, "http://127.0.0.1:8802/attacker")).toBe(false)
  expect(isTrustedFrameUrl(top, "https://greenhouse.io.evil.example/x")).toBe(false)
  expect(isTrustedFrameUrl(top, "about:blank")).toBe(false)
})

test("an offer scope is the site key, plus the tenant path on a shared host that has no tenant in its key", () => {
  expect(offerScope("https://job-boards.greenhouse.io/acme/jobs/1")).toBe("job-boards.greenhouse.io/acme")
  expect(offerScope("https://careers.example.com/jobs/1")).toBe("careers.example.com")
  expect(offerScope("https://sites.google.com/view/Acme/jobs")).toBe("sites.google.com/view/acme")
  expect(offerScope("https://forms.office.com/r/abc123")).toBe("forms.office.com/r/abc123")
  expect(offerScope("https://www.notion.so/")).toBe("www.notion.so")
  expect(offerScope("not a url")).toBeNull()
})
