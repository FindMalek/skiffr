// Real Chromium check of the fill engine on the fixture pages. Not part of `bun test`.
//   bun test/fixtures/build.ts && node test/browser/verify-fill.mjs [outDir]
// Needs the Chromium that playwright-core 1.65 uses, already installed (`channel: "chromium"`). Loads only local fixtures.
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/dist")
const OUT = process.argv[2] ?? join(tmpdir(), "skiffr-fill-evidence")
mkdirSync(OUT, { recursive: true })

const lines = []
let failures = 0
const log = (text = "") => {
  lines.push(text)
  console.log(text)
}
const check = (name, ok, extra = "") => {
  log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  ${extra}` : ""}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ channel: "chromium", headless: true })
const open = async (name, viewport = { width: 900, height: 1000 }) => {
  const page = await browser.newPage({ viewport })
  await page.goto(`file://${DIST}/${name}`)
  return page
}

/** Fills the page with `generate` mappings picked by label. A label matches itself or "<section>: <label>". */
const fillRows = (page, rows, options = {}) =>
  page.evaluate(
    async ({ rows, options }) => {
      const fill = window.skiffrFill
      const fields = fill.collectFields(document)
      const wanted = (label, row) => label === row || label?.endsWith(`: ${row}`)
      const mapping = fields.flatMap((f) => {
        const row = rows.find(([label]) => wanted(f.descriptor.label ?? f.descriptor.name, label))
        return row ? [{ id: f.id, action: "generate", value: row[1], confidence: row[2] ?? 0.9, reason: "" }] : []
      })
      const files = options.resume
        ? { resume: new File([new Uint8Array([37, 80, 68, 70])], "ada-cv.pdf", { type: "application/pdf" }) }
        : undefined
      const summary = await fill.fillPage({
        root: document,
        mapping,
        values: {},
        files,
        overwrite: options.overwrite,
        locale: options.locale,
      })
      window.__summary ??= summary
      return {
        descriptors: fields.map((f) => ({ ...f.descriptor, ambiguous: f.info.ambiguous })),
        summary: summary.fields,
        counts: summary.counts,
        state: window.__state?.(),
        submitted: window.__submitted,
      }
    },
    { rows, options },
  )

const table = (summary) => {
  log("  label | status | value | reason")
  for (const f of summary) log(`  ${f.label} | ${f.status} | ${f.value ?? ""} | ${f.reason ?? ""}`)
}
const statusOf = (res, label) => res.summary.find((f) => f.label === label || f.label?.endsWith(`: ${label}`))

const profile = { skills: "TypeScript, Rust" }

// real react, real vue, static page with shadow root, iframe, file, contenteditable, dates, angular style listener
for (const [name, url, rows, expected] of [
  [
    "react",
    "react.html",
    [
      ["First name", "Ada"],
      ["Email", "ada@example.com"],
      ["Phone", "555 123 4567"],
      ["Country", "USA"],
      ["Are you authorized to work here?", "yes"],
      ["Skills", profile.skills],
      ["I agree to the terms", "yes"],
      ["Summary", "Engineer who likes compilers.", 0.4],
      ["Department", "engineering"],
    ],
    {
      first: "Ada",
      email: "ada@example.com",
      phone: "(555) 123-4567",
      country: "US",
      auth: "Yes",
      skills: ["TypeScript", "Rust"],
      agree: true,
      summary: "Engineer who likes compilers.",
      dept: "Engineering",
    },
  ],
  [
    "vue",
    "vue.html",
    [
      ["First name", "Ada"],
      ["Email", "ada@example.com"],
      ["Country", "United States"],
      ["Willing to relocate?", "no"],
      ["Skills", "Go"],
      ["I agree to the terms", "true"],
      ["Summary", "Hello vue"],
    ],
    {
      first: "Ada",
      email: "ada@example.com",
      country: "US",
      auth: "No",
      skills: ["Go"],
      agree: true,
      summary: "Hello vue",
    },
  ],
]) {
  log(`\n== ${name}`)
  const page = await open(url)
  const control = await page.evaluate(async () => {
    const input = document.querySelector("#first")
    input.value = "Ada"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))
    const stateful = window.__state().first
    input.value = ""
    return stateful
  })
  if (name === "react") check("control: plain .value= on a react input never reaches state", control === "")
  const page2 = await open(url)
  const res = await fillRows(page2, rows)
  table(res.summary)
  check(
    `${name}: framework state holds every value`,
    JSON.stringify(res.state) === JSON.stringify(expected),
    JSON.stringify(res.state),
  )
  check(`${name}: no failures`, res.counts.failed === 0, JSON.stringify(res.counts))
  check(`${name}: form not submitted`, res.submitted === false)
  await page2.screenshot({ path: join(OUT, `${name}-filled.png`), fullPage: true })
  if (name === "react") {
    const again = await fillRows(page2, rows)
    check(
      "react: second pass changes nothing",
      again.counts.unchanged === 9 && again.counts.filled === 0,
      JSON.stringify(again.counts),
    )
    const outline = await page2.evaluate(() => getComputedStyle(document.getElementById("summary")).outlineStyle)
    check("react: low confidence field outlined", outline === "solid", outline)
    await page2.evaluate(() => {
      window.__edits = []
      window.__stop = window.skiffrFill.watchEdits(document, window.__summary, (r) => window.__edits.push(r))
    })
    await page2.click("#first")
    await page2.keyboard.press("End")
    await page2.keyboard.type("x")
    await page2.click("#email")
    const edits = await page2.evaluate(() => window.__edits)
    check(
      "react: a real keystroke is reported by watchEdits",
      edits.at(-1)?.filledValue === "Ada" && edits.at(-1)?.finalValue === "Adax",
      JSON.stringify(edits),
    )
    await page2.evaluate(() => window.__summary.clearHighlights())
    check(
      "react: outline removed",
      (await page2.evaluate(() => getComputedStyle(document.getElementById("summary")).outlineStyle)) === "none",
    )
  }
  await page.close()
  await page2.close()
}

await (async () => {
  log("\n== static")
  const page = await open("static.html", { width: 900, height: 1300 })
  await page.setInputFiles("#cv", [])
  const res = await fillRows(
    page,
    [
      ["Full name", "Ada Lovelace"],
      ["Email", "ada@example.com"],
      ["Phone", "+1 (555) 123-4567"],
      ["Date of birth", "12/25/1990"],
      ["Start date", "2025-03-05"],
      ["Country", "USA"],
      ["Do you need sponsorship?", "no"],
      ["Tools you use", "Docker"],
      ["Cover note", "I like small teams."],
      ["Nickname", "ada"],
      ["Referral", "a friend"],
      ["Angular style field", "ng value"],
    ],
    { resume: true },
  )
  table(res.summary)
  const dom = await page.evaluate(() => ({
    ng: window.__ng,
    file: document.getElementById("cv").files[0]?.name,
    note: document.getElementById("note").innerText,
    shadow: document.getElementById("shadow-host").shadowRoot.getElementById("s").value,
    frame: document.getElementById("frame").contentDocument.getElementById("x").value,
    born: document.getElementById("born").value,
    start: document.getElementById("start").value,
    phone: document.getElementById("phone").value,
    country: document.getElementById("country").value,
    sponsor: [...document.querySelectorAll("[name=sponsor]")].map((r) => r.checked),
    tools: [...document.querySelectorAll("[name=tools]")].map((r) => r.checked),
    traps: [...document.querySelectorAll("[name=url2],[name=hp2],input[name=website]")].map((i) => i.value),
  }))
  const labels = res.descriptors.map((d) => d.label ?? `(${d.name})`)
  check(
    "static: honeypots not collected",
    !labels.some((l) => /Leave this empty|Fax|\(url2\)|\(hp2\)|\(website\)/.test(l)),
    labels.join(" | "),
  )
  check(
    "static: honeypot values empty",
    dom.traps.every((v) => v === ""),
  )
  check("static: shadow root and iframe inputs filled", dom.shadow === "ada" && dom.frame === "a friend")
  check("static: resume attached via DataTransfer", dom.file === "ada-cv.pdf")
  check("static: contenteditable", dom.note === "I like small teams.", dom.note)
  check("static: date input, unambiguous 12/25/1990", dom.born === "1990-12-25", dom.born)
  check("static: text date reformatted from ISO to the placeholder", dom.start === "05/03/2025", dom.start)
  check("static: phone kept whole", dom.phone.endsWith("5551234567"), dom.phone)
  check("static: country fuzzy USA -> United States", dom.country === "US", dom.country)
  check(
    "static: radio and checkbox group",
    JSON.stringify(dom.sponsor) === "[false,true]" && JSON.stringify(dom.tools) === "[false,true]",
  )
  check(
    "static: angular style binding saw input and blur",
    dom.ng.value === "ng value" && dom.ng.touched === true,
    JSON.stringify(dom.ng),
  )
  check("static: form not submitted", res.submitted === false)
  await page.screenshot({ path: join(OUT, "static-filled.png"), fullPage: true })
  await page.close()
})()

await (async () => {
  log("\n== honeypots (40 hidden fields, 5 legit ones)")
  const page = await open("honeypots.html", { width: 1000, height: 1600 })
  const res = await page.evaluate(async () => {
    const fill = window.skiffrFill
    const fields = fill.collectFields(document)
    const mapping = fields.map((f) => ({ id: f.id, action: "generate", value: "x", confidence: 1, reason: "" }))
    await fill.fillPage({ root: document, mapping, values: {} })
    return { labels: fields.map((f) => f.descriptor.label ?? f.descriptor.name), traps: window.__trapValues() }
  })
  const collectedTraps = res.labels.filter((l) => /TRAP/.test(l))
  check("honeypots: none of the 40 hidden fields is collected", collectedTraps.length === 0, collectedTraps.join(", "))
  check(
    "honeypots: none of them received a value",
    res.traps.length === 40 && res.traps.every(([, v]) => v === ""),
    res.traps
      .filter(([, v]) => v)
      .map(([n]) => n)
      .join(","),
  )
  for (const legit of [
    "LEGIT visible",
    "LEGIT checkbox",
    "LEGIT framed",
    "LEGIT shadow",
    "LEGIT scrolled",
    "LEGIT below the fold",
  ]) {
    check(
      `honeypots: ${legit} still collected`,
      res.labels.some((l) => l?.endsWith(legit)),
      res.labels.filter((l) => l?.includes("LEGIT")).join(" | "),
    )
  }
  await page.screenshot({ path: join(OUT, "honeypots.png") })
  await page.close()
})()

await (async () => {
  log("\n== react-select (real library, label inside the wrapper)")
  const page = await open("react-select.html")
  const res = await fillRows(page, [
    ["Gender", "Male"],
    ["Country", "usa"],
    ["Are you legally authorized to work in the United States?", "yes"],
  ])
  table(res.summary)
  check(
    "react-select: state holds all three values",
    JSON.stringify(res.state) === JSON.stringify({ gender: "Male", country: "United States", authorized: "Yes" }),
    JSON.stringify(res.state),
  )
  check(
    "react-select: all reported filled, none failed",
    res.counts.filled === 3 && res.counts.failed === 0,
    JSON.stringify(res.counts),
  )
  check(
    "react-select: the unrelated listbox was never used",
    (await page.evaluate(() => window.__state().country)) === "United States",
  )
  await page.screenshot({ path: join(OUT, "react-select-filled.png") })
  await page.close()
})()

await (async () => {
  log("\n== resume slots")
  for (const [name, page, expectedFiles, note] of [
    ["lever", "fill-lever.html", [1], "label has stars and joined text nodes"],
    ["workable", "fill-workable.html", [0, 1, 0], "three unlabeled uploads, headings only"],
    ["ashby", "fill-ashby.html", [1], "a single unlabeled upload"],
  ]) {
    const p = await open(page)
    const res = await fillRows(
      p,
      [
        ["Full name", "Ada Lovelace"],
        ["Email", "ada@example.com"],
      ],
      { resume: true },
    )
    const files = await p.evaluate(() => [...document.querySelectorAll("input[type=file]")].map((i) => i.files.length))
    check(
      `${name}: resume goes to the right slot (${note})`,
      JSON.stringify(files) === JSON.stringify(expectedFiles),
      JSON.stringify(files),
    )
    if (name === "lever") {
      const labels = res.descriptors.map((d) => d.label)
      check(
        "lever: stars stripped, text nodes spaced",
        labels.includes("Full name") && labels.includes("Email") && labels.includes("First name Last name"),
        labels.join(" | "),
      )
    }
    await p.close()
  }
})()

await (async () => {
  log("\n== edge cases")
  const page = await open("fill-edge.html", { width: 900, height: 1400 })
  const res = await fillRows(page, [
    ["Applicant: Name", "Ada Lovelace"],
    ["Reference: Name", "Grace Hopper"],
    ["Email", "test.applicant@example.com"],
    ["Salary", "85.000,50"],
    ["Phone", "+1 (000) 000-0000"],
    ["Date of birth", "03/04/2025"],
    ["Country", "usa"],
    ["Region", "United States"],
    ["Do you need sponsorship?", "yes"],
    ["Outlined", "x", 0.3],
    ["Own editor", "hello own"],
    ["Reverting editor", "hello rev"],
  ])
  table(res.summary)
  const dom = await page.evaluate(() => ({
    email: document.getElementById("email").value,
    salary: document.getElementById("salary").value,
    phone: document.getElementById("phone").value,
    born: document.getElementById("born").value,
    country: document.getElementById("country").value,
    region: document.getElementById("region").value,
    sp: document.querySelector("[name=sp]:checked").value,
    outline: getComputedStyle(document.getElementById("outlined")).outlineStyle,
    own: window.__own,
    rev: document.getElementById("rev").textContent,
    countryOptions: [...document.querySelectorAll("#country option")].length,
  }))
  const twins = res.descriptors.filter((d) => d.label?.endsWith("Name"))
  check(
    "section: applicant and reference Name differ",
    twins.map((d) => d.label).join() === "Applicant: Name,Reference: Name",
    twins.map((d) => d.label).join(),
  )
  check("email is never cut to maxlength", statusOf(res, "Email")?.status === "failed" && dom.email === "", dom.email)
  check(
    "85.000,50 into a number input fails as ambiguous",
    statusOf(res, "Salary")?.status === "failed" &&
      dom.salary === "" &&
      /ambiguous/.test(statusOf(res, "Salary")?.reason ?? ""),
    dom.salary,
  )
  check(
    "tel that does not fit maxlength fails, not cut",
    statusOf(res, "Phone")?.status === "failed" && dom.phone === "",
    dom.phone,
  )
  check("03/04/2025 fails without a locale", statusOf(res, "Date of birth")?.status === "failed" && dom.born === "")
  check(
    "select prompt option is not a pre-selection",
    statusOf(res, "Country")?.status === "filled" && dom.country === "United States",
    dom.country,
  )
  check(
    "pre-selected select is protected",
    statusOf(res, "Region")?.status === "skipped" && dom.region === "Quebec",
    dom.region,
  )
  check(
    "pre-checked radio is protected",
    statusOf(res, "Do you need sponsorship?")?.status === "skipped" && dom.sp === "no",
    dom.sp,
  )
  check("outline beats input#x { outline: none !important }", dom.outline === "solid", dom.outline)
  check(
    "beforeinput editor receives the text",
    dom.own === "hello own" && statusOf(res, "Own editor")?.status === "filled",
    String(dom.own),
  )
  check(
    "reverting editor is reported failed and left empty",
    statusOf(res, "Reverting editor")?.status === "failed" && dom.rev === "",
    dom.rev,
  )

  const withLocale = await page.evaluate(async () => {
    const fill = window.skiffrFill
    const born = fill.collectFields(document).find((f) => f.el.id === "born")
    const salary = fill.collectFields(document).find((f) => f.el.id === "salary")
    const date = await fill.fillField(born.el, "03/04/2025", { locale: "en-GB" })
    const number = await fill.fillField(salary.el, "85.000,50", { locale: "de-DE" })
    return { date: date.value, number: number.value }
  })
  check(
    "explicit locale decides date order and separators",
    withLocale.date === "2025-04-03" && withLocale.number === "85000.50",
    JSON.stringify(withLocale),
  )

  const decoy = await page.evaluate(async () => {
    const dept = window.skiffrFill.collectFields(document).find((f) => f.el.id === "dept")
    const result = await window.skiffrFill.fillField(dept.el, "Engineering")
    return { status: result.status, decoyClicked: window.__decoyClicked }
  })
  check(
    "combobox ignores an unrelated visible listbox",
    decoy.status === "failed" && decoy.decoyClicked === false,
    JSON.stringify(decoy),
  )
  const portal = await page.evaluate(async () => {
    const dept = window.skiffrFill.collectFields(document).find((f) => f.el.id === "dept")
    const result = await window.skiffrFill.fillField(dept.el, "design")
    return { status: result.status, value: dept.el.value }
  })
  check(
    "combobox picks from a menu inserted when it opens",
    portal.status === "filled" && portal.value === "Design",
    JSON.stringify(portal),
  )

  // a page script forging gestures must not read as a user edit
  const forged = await page.evaluate(async () => {
    const fill = window.skiffrFill
    window.__summary = undefined
    const fields = fill.collectFields(document)
    const forge = fields.find((f) => f.el.id === "forge")
    const box = fields.find((f) => f.el.id === "forgecb")
    const summary = await fill.fillPage({
      root: document,
      mapping: [
        { id: forge.id, action: "generate", value: "filled", confidence: 1, reason: "" },
        { id: box.id, action: "generate", value: "no", confidence: 1, reason: "" },
      ],
      values: {},
      overwrite: true,
    })
    window.__reports = []
    window.__stop = fill.watchEdits(document, summary, (r) => window.__reports.push(r))
    return summary.fields.map((f) => f.status)
  })
  await page.evaluate(() => {
    const input = document.getElementById("forge")
    input.value = "forged"
    input.focus()
    input.blur()
    const box = document.getElementById("forgecb")
    box.click()
  })
  const forgedReports = await page.evaluate(() => window.__reports)
  check(
    "forged value + focus + blur from page script is not an edit",
    forgedReports.length === 0,
    JSON.stringify(forgedReports),
  )
  await page.click("#forge")
  await page.keyboard.press("End")
  await page.keyboard.type("!")
  await page.click("#email")
  const real = await page.evaluate(() => window.__reports)
  check(
    "a real keystroke after the forgery is reported",
    real.some((r) => r.finalValue === "forged!"),
    JSON.stringify(real) + forged.join(),
  )
  await page.close()
})()

await (async () => {
  log("\n== cost on a 2000 field page")
  const page = await open("fill-edge.html")
  const stats = await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      Array.from(
        { length: 2000 },
        (_, i) => `<div class="g${i % 20}"><label for="p${i}">Field ${i}</label><input id="p${i}" name="p${i}"></div>`,
      ).join(""),
    )
    let calls = 0
    const original = window.getComputedStyle
    window.getComputedStyle = (...args) => {
      calls++
      return original.apply(window, args)
    }
    const start = performance.now()
    const fields = window.skiffrFill.collectFields(document)
    const ms = performance.now() - start
    window.getComputedStyle = original
    return { fields: fields.length, ms: Math.round(ms), calls }
  })
  log(`  collected ${stats.fields} fields in ${stats.ms} ms with ${stats.calls} getComputedStyle calls`)
  check("2000 fields collected", stats.fields >= 2000)
  check("getComputedStyle calls stay far below one per ancestor per field", stats.calls < 9000, String(stats.calls))
  await page.close()
})()

await browser.close()
log(failures ? `\n${failures} failing` : "\nall checks pass")
writeFileSync(join(OUT, "verify-fill.txt"), `${lines.join("\n")}\n`)
process.exit(failures ? 1 : 0)
