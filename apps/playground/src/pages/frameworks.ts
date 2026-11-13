import { CORE, type Field, LINKS, QUESTIONS } from "../fields.ts"
import { esc } from "../html.ts"
import { control, star } from "./controls.ts"
import { jobDescription, shell } from "./shell.ts"

const FORM_CSS =
  ".row, #root form > div, #app form > div { margin: 12px 0 } .check, #root form > label, #app form > label { display: block; margin: 14px 0; font-weight: 400 } #root label > span { color: #b42318 }"

export function react(): string {
  return shell({
    title: "Senior Engineer - Acme (React)",
    css: FORM_CSS,
    body: `<main class="wrap">${jobDescription()}<div id="root"></div></main><script src="/client/react-form.js"></script>`,
  })
}

export function vue(): string {
  return shell({
    title: "Senior Engineer - Acme (Vue)",
    css: FORM_CSS,
    body: `<main class="wrap">${jobDescription()}<div id="app"></div></main><script src="/client/vue-form.js"></script>`,
  })
}

/** The form is built inside an open shadow root, labels and button included. */
export function shadow(): string {
  const fields: Field[] = [...CORE.slice(0, 4), ...LINKS.slice(0, 1), ...QUESTIONS.slice(0, 1)]
  const rows = fields
    .map(
      (field) =>
        `<div class="row"><label for="${field.key}">${esc(field.label)}${star(field)}</label>${control(field, { id: field.key, name: field.key })}</div>`,
    )
    .join("")
  const markup = `<style>
  :host { display: block }
  .row { margin: 12px 0 } label { display: block; font-weight: 600; margin-bottom: 4px } .req { color: #b42318 }
  input, textarea, select { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid #bbb; border-radius: 4px; font: inherit }
  .btn { padding: 10px 20px; border: 1px solid #333; background: #111; color: #fff; border-radius: 4px; font: inherit }
</style>
<form method="post" action="/api/submissions" novalidate>${rows}
<label><input type="checkbox" id="privacy" name="privacy" value="yes"> I agree to the Acme privacy policy</label>
<p><button type="submit" class="btn">Submit application</button></p></form>`
  return shell({
    title: "Senior Engineer - Acme (shadow DOM)",
    body: `<main class="wrap">${jobDescription()}<acme-apply-form data-pg-form-host></acme-apply-form></main>
<template id="apply-template">${markup}</template>
<script>
  class AcmeApplyForm extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: "open" })
      root.append(document.getElementById("apply-template").content.cloneNode(true))
      root.querySelector("form").addEventListener("submit", (event) => window.PG.prepare(event.target))
    }
  }
  customElements.define("acme-apply-form", AcmeApplyForm)
</script>`,
  })
}

/** Real fields next to traps no person sees. Autofill that touches a trap shows up red in /inspect. */
export function honeypot(): string {
  const real = [...CORE.slice(0, 4), ...QUESTIONS.slice(0, 1)]
    .map(
      (field) =>
        `<div class="row"><label for="${field.key}">${esc(field.label)}${star(field)}</label>${control(field, { id: field.key, name: field.key })}</div>`,
    )
    .join("")
  return shell({
    title: "Senior Engineer - Acme careers",
    css: FORM_CSS,
    body: `<main class="wrap">${jobDescription()}<h2>Apply</h2><form action="/api/submissions" method="post" class="apply-form" novalidate>
${real}
<div style="position:absolute;left:-9999px;top:auto" aria-hidden="true"><label for="website_url">Website</label><input type="text" id="website_url" name="website_url" tabindex="-1" autocomplete="off" data-pg-trap></div>
<div style="display:none"><label for="email_confirm">Confirm your email</label><input type="text" id="email_confirm" name="email_confirm" autocomplete="off" data-pg-trap></div>
<div style="opacity:0;height:1px;overflow:hidden"><label for="phone_backup">Backup phone</label><input type="tel" id="phone_backup" name="phone_backup" autocomplete="off" data-pg-trap></div>
<div class="row"><label for="company_fax">Fax</label><input type="text" id="company_fax" name="company_fax" disabled data-pg-trap></div>
<button type="submit" class="btn">Send application</button></form></main>`,
  })
}

export function embedParent(frameUrl: string): string {
  return shell({
    title: "Careers - Acme",
    body: `<header style="padding:12px 16px;border-bottom:1px solid #ddd"><strong>Acme</strong></header><main class="wrap">${jobDescription()}
<h2>Apply</h2><p>The application form below is served by our applicant tracking system.</p>
<iframe id="grnhse_iframe" title="Greenhouse application" src="${esc(frameUrl)}" width="100%" height="1100" style="border:0"></iframe></main>`,
  })
}
