import { CONSENT, CORE, EEO, type Field, LINKS, QUESTIONS } from "../fields.ts"
import { esc } from "../html.ts"
import { control, star } from "./controls.ts"
import { jobDescription, shell } from "./shell.ts"

const byKey = (fields: Field[], ...keys: string[]): Field[] =>
  keys.flatMap((key) => fields.filter((field) => field.key === key))

const FORM = 'method="post" action="/api/submissions" enctype="multipart/form-data" novalidate'

function smartrecruiters(): string {
  const row = (field: Field): string =>
    `<spl-input-field class="field"><label id="sr-${field.key}-label" for="sr-${field.key}">${esc(field.label)}${star(field)}</label>${control(field, { id: `sr-${field.key}`, name: field.key, cls: "spl-input" })}</spl-input-field>`
  const consent = CONSENT.filter((field) => field.kind === "checkbox")
    .map(
      (field) =>
        `<spl-checkbox class="field"><label class="check"><input type="checkbox" name="${field.key}" value="yes"> ${esc(field.label)}</label></spl-checkbox>`,
    )
    .join("")
  return shell({
    title: "Senior Engineer - Acme - SmartRecruiters",
    css: "spl-input-field, spl-checkbox, oc-section { display: block } .header { background: #0c3b5c; color: #fff; padding: 12px 16px } oc-section h2 { margin: 24px 0 0 }",
    body: `<div class="header">Acme</div><main class="wrap">${jobDescription()}<section id="st-apply" class="apply">
<form id="application-form" class="oc-application-form" ${FORM}>
<oc-section><h2>Personal information</h2>${CORE.map(row).join("")}</oc-section>
<oc-section><h2>Links</h2>${byKey(LINKS, "linkedin", "website").map(row).join("")}</oc-section>
<oc-section><h2>Questions</h2>${[...byKey(QUESTIONS, "why"), ...byKey(QUESTIONS, "authorized", "source")].map(row).join("")}</oc-section>
<oc-section><h2>Consent</h2>${consent}</oc-section>
<button type="submit" class="btn" data-test="submit-application">Submit application</button>
</form></section></main>`,
  })
}

function teamtailor(): string {
  const name = (key: string): string => `candidate[${key}]`
  const row = (field: Field): string =>
    field.kind === "select" || field.kind === "textarea" || field.kind === "file"
      ? `<div class="form-group"><label for="candidate_${field.key}">${esc(field.label)}</label>${control(field, { id: `candidate_${field.key}`, name: name(field.key), cls: "form-control" })}</div>`
      : `<div class="form-group floating-label">${control(field, { id: `candidate_${field.key}`, name: name(field.key), cls: "form-control", attrs: 'placeholder=" "' })}<label for="candidate_${field.key}">${esc(field.label)}${star(field)}</label></div>`
  return shell({
    title: "Senior Engineer - Acme careers",
    css: ".floating-label { position: relative; margin: 14px 0 } .floating-label label { position: absolute; top: -9px; left: 8px; background: #fff; padding: 0 4px; font-size: 12px; margin: 0 } .form-group { margin: 14px 0 }",
    bodyAttrs: 'class="teamtailor"',
    body: `<main class="wrap">${jobDescription()}<form id="new_job_application" class="new_job_application" ${FORM}>
<input type="hidden" name="authenticity_token" value="pg-test-token">
${[...CORE, ...byKey(LINKS, "linkedin"), ...byKey(QUESTIONS, "why", "source")].map(row).join("")}
<div class="form-group"><label class="check"><input type="checkbox" id="candidate_privacy" name="candidate[privacy_policy]" value="yes"> I agree to the Acme privacy policy</label></div>
<button type="submit" class="btn">Send application</button></form></main>`,
  })
}

function bamboohr(): string {
  const row = (field: Field, name = field.key): string =>
    `<div class="fab-FormRow"><label class="fab-Label" for="${name}">${esc(field.label)}${field.required ? '<span class="fab-Label__required">*</span>' : ""}</label><div class="fab-FormField">${control(field, { id: name, name, cls: "fab-TextInput" })}</div></div>`
  const camel = (key: string): string => key.replace(/_(\w)/g, (_, char: string) => char.toUpperCase())
  const extra: Field[] = [
    { key: "desiredPay", kind: "text", label: "Desired Pay" },
    { key: "dateAvailable", kind: "date", label: "Date Available" },
  ]
  return shell({
    title: "Senior Engineer - Acme Careers",
    css: ".fab-FormRow { margin: 12px 0 } .fab-Label { font-weight: 600 } .fab-Label__required { color: #b42318; margin-left: 2px }",
    body: `<div class="ResAts"><main class="wrap">${jobDescription()}<form class="ResAts__form" id="applicationForm" ${FORM}>
<h2 class="ResAts__heading">Application Form</h2>
${[...CORE, ...byKey(LINKS, "linkedin", "website")].map((field) => row(field, camel(field.key))).join("")}
${extra.map((field) => row(field)).join("")}
<div class="fab-FormRow"><span class="fab-Label" id="legallyAuthorized-label">Are you legally authorized to work in this country?</span>
<div class="fab-FormField">${control({ key: "legallyAuthorized", kind: "radio", label: "", options: ["Yes", "No"] }, { id: "legallyAuthorized", name: "legallyAuthorized" })}</div></div>
${row(QUESTIONS[0] as Field, "whyAcme")}
<button type="submit" class="fab-Button fab-Button--primary btn">Submit Application</button></form></main></div>`,
  })
}

function recruitee(): string {
  const row = (field: Field, name: string): string =>
    `<div class="form-field"><label for="${name}">${esc(field.label)}${star(field)}</label>${control(field, { id: name, name, cls: "input", attrs: 'data-v-7ba5bd90=""' })}</div>`
  const fields: [Field, string][] = [
    [{ key: "name", kind: "text", label: "Full name", required: true, autocomplete: "name" }, "candidate[name]"],
    [CORE[2] as Field, "candidate[email]"],
    [CORE[3] as Field, "candidate[phone]"],
    [CORE[5] as Field, "candidate[cv]"],
    [{ key: "cover", kind: "textarea", label: "Cover letter" }, "candidate[cover_letter]"],
    [LINKS[0] as Field, "candidate[links][0]"],
    [QUESTIONS[2] as Field, "candidate[open_question_answers][0]"],
  ]
  return shell({
    title: "Senior Engineer - Acme - Recruitee",
    css: ".form-field { margin: 12px 0 }",
    body: `<div id="app" data-v-app=""><main class="wrap">${jobDescription()}<form class="candidate-form" ${FORM}>
${fields.map(([field, name]) => row(field, name)).join("")}
<div class="form-field"><label class="check"><input type="checkbox" id="gdpr" name="candidate[gdpr_consent]" value="yes"> I consent to Acme storing my application for the purpose of this job (GDPR)</label></div>
<button type="submit" class="btn">Apply</button></form></main></div>`,
  })
}

function personio(): string {
  const row = (field: Field): string =>
    `<div class="form-group"><label for="${field.key}">${esc(field.label)}${star(field)}</label>${control(field, { id: field.key, name: field.key, cls: "form-control" })}</div>`
  const extra: Field[] = [
    { key: "earliest_start", kind: "date", label: "Earliest starting date" },
    { key: "salary", kind: "text", label: "Salary expectations (gross per year)" },
    { key: "weekly_hours", kind: "text", label: "Weekly working hours" },
  ]
  const consent = byKey(CONSENT, "privacy", "talent")
    .map(
      (field) =>
        `<div class="form-group"><label class="check"><input type="checkbox" id="${field.key}" name="${field.key}" value="yes"> ${esc(field.label)}</label></div>`,
    )
    .join("")
  return shell({
    title: "Senior Engineer - Acme - Jobs",
    bodyAttrs: 'data-qa="job-page"',
    body: `<main class="wrap">${jobDescription()}<form class="application-form" data-qa="application-form" ${FORM}>
<h2>Apply now</h2>
${[...byKey(CORE, "first_name", "last_name", "email", "phone"), ...extra, ...byKey(CORE, "resume"), ...byKey(QUESTIONS, "source")].map(row).join("")}
<h3>Data privacy</h3>${consent}
<button type="submit" class="btn" data-qa="submit-application">Submit application</button></form></main>`,
  })
}

function join(): string {
  const row = (field: Field): string => {
    const id = `input-${field.key}`
    const bare = control(field, { id, name: field.key, cls: "MuiInputBase-input" })
    return `<div class="MuiFormControl-root MuiTextField-root"><label class="MuiFormLabel-root MuiInputLabel-root MuiInputLabel-shrink" id="${id}-label" for="${id}">${esc(field.label)}${field.required ? " *" : ""}</label><div class="MuiInputBase-root MuiOutlinedInput-root">${bare}</div></div>`
  }
  return shell({
    title: "Senior Engineer - Acme | JOIN",
    css: ".MuiFormControl-root { position: relative; margin: 22px 0 } .MuiInputLabel-root { position: absolute; top: -10px; left: 10px; background: #fff; padding: 0 4px; font-size: 12px; margin: 0; z-index: 1 }",
    body: `<div id="__next"><main class="wrap">${jobDescription()}<form class="MuiBox-root" ${FORM}>
${[...CORE, ...byKey(LINKS, "linkedin"), ...byKey(QUESTIONS, "why")].map(row).join("")}
<label class="check"><input type="checkbox" name="privacy" id="privacy"> I have read and accept the privacy policy</label>
<label class="check"><input type="checkbox" name="talent" id="talent"> Keep me in the talent pool</label>
<button type="submit" class="btn MuiButton-root">Send application</button></form></main></div>`,
  })
}

function generic(): string {
  const wrap = (field: Field): string =>
    field.kind === "radio" || field.kind === "checkbox"
      ? `<label class="check">${control(field, { id: field.key, name: field.key })} ${esc(field.label)}</label>`
      : `<label>${esc(field.label)}${star(field)}${control(field, { id: field.key, name: field.key })}</label>`
  return shell({
    title: "Senior Engineer - Careers at Acme",
    body: `<header style="padding:12px 16px;border-bottom:1px solid #ddd"><strong>Acme</strong> careers</header><main class="wrap">${jobDescription()}<h2>Apply for this role</h2>
<form action="/api/submissions" method="post" enctype="multipart/form-data" class="apply-form" novalidate>
${[...CORE, ...byKey(LINKS, "linkedin", "website"), ...byKey(QUESTIONS, "why", "notice")].map(wrap).join("")}
<button type="submit" class="btn">Send application</button></form></main>`,
  })
}

/** The eeo page reuses the same pieces on a company page. */
export function eeoPage(): string {
  const wrap = (field: Field): string =>
    field.kind === "checkbox"
      ? `<label class="check"><input type="checkbox" id="${field.key}" name="${field.key}" value="yes"> ${esc(field.label)}</label>`
      : `<label for="${field.key}">${esc(field.label)}${star(field)}</label>${control(field, { id: field.key, name: field.key })}`
  return shell({
    title: "Apply - Senior Engineer - Acme",
    body: `<main class="wrap">${jobDescription()}<h2>Apply for this role</h2>
<form action="/api/submissions" method="post" class="apply-form" novalidate>
<h3>About you</h3>${[...byKey(CORE, "first_name", "last_name", "email", "phone"), ...byKey(LINKS, "linkedin")].map(wrap).join("")}
<h3>Equal opportunity (voluntary)</h3><p>Acme is an equal opportunity employer. Answering is voluntary and does not affect your application.</p>
${EEO.map(wrap).join("")}
<h3>Consent and signature</h3>${CONSENT.map(wrap).join("")}
<button type="submit" class="btn">Submit application</button></form></main>`,
  })
}

export const BOARD_PAGES: Record<string, () => string> = {
  smartrecruiters,
  teamtailor,
  bamboohr,
  recruitee,
  personio,
  join,
  generic,
  eeo: eeoPage,
}
