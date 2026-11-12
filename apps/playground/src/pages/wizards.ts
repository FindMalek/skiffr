import { COUNTRIES, EEO, JOB } from "../fields.ts"
import { esc } from "../html.ts"
import type { Switches } from "../switches.ts"
import { shell } from "./shell.ts"

interface Step {
  title: string
  html: string
  review?: boolean
  cta?: string
}

const json = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c")

const opts = (list: readonly string[]): string => esc(JSON.stringify(list))

function wizardScript(config: Record<string, unknown>): string {
  return `<script>window.__WIZARD=${json(config)}</script><script src="/wizard.js"></script>`
}

export function linkedin(): string {
  const urn = "urn-li-jobs-applyformcommon-easyApplyFormElement-4001006-9001"
  const steps: Step[] = [
    {
      title: "Contact info",
      html: `<div class="jobs-easy-apply-form-section__grouping" data-field>
<label for="${urn}-email">Email address <span class="req">*</span></label>
<select id="${urn}-email" name="email" required aria-required="true"><option value="">Select an option</option><option value="ana.silva@example.com">ana.silva@example.com</option><option value="ana.work@example.com">ana.work@example.com</option></select></div>
<div class="jobs-easy-apply-form-section__grouping" data-field>
<label for="${urn}-phoneNumber-country">Phone country code <span class="req">*</span></label>
<select id="${urn}-phoneNumber-country" name="phone_country" required aria-required="true"><option value="">Select an option</option>${COUNTRIES.map((country) => `<option value="${esc(country)}">${esc(country)}</option>`).join("")}</select></div>
<div class="jobs-easy-apply-form-section__grouping" data-field>
<label for="${urn}-phoneNumber-nationalNumber">Mobile phone number <span class="req">*</span></label>
<input id="${urn}-phoneNumber-nationalNumber" name="phone" type="text" required aria-required="true" autocomplete="tel-national"></div>`,
    },
    {
      title: "Resume",
      html: `<div class="jobs-easy-apply-form-section__grouping" data-field><p>Be sure to include an updated resume</p>
<label for="jobs-document-upload-file-input-upload-resume">Upload resume <span class="req">*</span></label>
<input id="jobs-document-upload-file-input-upload-resume" name="resume" type="file" required aria-required="true"></div>`,
    },
    {
      title: "Additional Questions",
      html: `<div class="jobs-easy-apply-form-section__grouping" data-field>
<label for="${urn}-years">How many years of work experience do you have with TypeScript? <span class="req">*</span></label>
<input id="${urn}-years" name="years_typescript" type="text" required aria-required="true"></div>
<fieldset class="jobs-easy-apply-form-section__grouping" data-test-form-builder-radio-button-form-component="true" data-field>
<legend>Are you comfortable working in a remote setting? <span class="req">*</span></legend>
<label class="radio"><input type="radio" name="remote_ok" value="Yes" required aria-required="true"> Yes</label>
<label class="radio"><input type="radio" name="remote_ok" value="No"> No</label></fieldset>
<div class="jobs-easy-apply-form-section__grouping" data-field>
<label for="${urn}-sponsor">Will you now or in the future require sponsorship for employment visa status?</label>
<select id="${urn}-sponsor" name="sponsorship"><option value="">Select an option</option><option value="Yes">Yes</option><option value="No">No</option></select></div>
<div class="jobs-easy-apply-form-section__grouping" data-field>
<label for="${urn}-why">Why do you want to work at Acme?</label>
<textarea id="${urn}-why" name="why" rows="4"></textarea></div>`,
    },
    {
      title: "Voluntary self identification",
      html: `<p>Acme is an equal opportunity employer. Answering these questions is voluntary.</p>${EEO.map(
        (field) =>
          `<div class="jobs-easy-apply-form-section__grouping" data-field><label for="${urn}-${field.key}">${esc(field.label)}</label><select id="${urn}-${field.key}" name="${field.key}"><option value="">Select an option</option>${(field.options ?? []).map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select></div>`,
      ).join("")}`,
    },
    {
      title: "Review your application",
      review: true,
      html: `<p>Check what you are about to send to Acme.</p>{{review}}`,
    },
  ]
  return shell({
    title: "Senior Engineer | Acme | LinkedIn",
    css: `.top { background: #fff; border-bottom: 1px solid #ddd; padding: 10px 16px; color: #0a66c2; font-weight: 700 }
.artdeco-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: none; align-items: center; justify-content: center; z-index: 50 }
.artdeco-modal-overlay.open { display: flex }
.artdeco-modal { background: #fff; width: min(560px, 94vw); max-height: 90vh; overflow: auto; border-radius: 8px; padding: 20px }
.jobs-easy-apply-form-section__grouping { margin: 16px 0 }
.artdeco-button { padding: 8px 20px; border-radius: 99px; border: 1px solid #0a66c2; background: #0a66c2; color: #fff; font: inherit; cursor: pointer }
.artdeco-button--secondary { background: #fff; color: #0a66c2 }
.apply-bar { margin: 16px 0 }
.review-list { padding-left: 18px }`,
    body: `<div class="top">in | Jobs</div><main class="wrap" data-view="jobs-details">
<h1>${esc(JOB.title)}</h1><p>${esc(JOB.company)} · ${esc(JOB.location)}</p>
<div class="apply-bar"><button type="button" class="artdeco-button jobs-apply-button" id="jobs-apply-button-id" aria-label="Easy Apply to ${esc(JOB.title)} at Acme">Easy Apply</button></div>
<section id="job-description" class="pg-job"><h2>About the job</h2><p>${esc(JOB.intro)}</p>${JOB.sections.map((section) => `<h3>${esc(section.heading)}</h3>${"text" in section ? `<p>${esc(section.text)}</p>` : `<ul>${section.list.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`}`).join("")}</section></main>
<div class="artdeco-modal-overlay" id="easy-apply-overlay"><div class="artdeco-modal jobs-easy-apply-modal" role="dialog" aria-labelledby="jobs-apply-header" aria-modal="true">
<h2 id="jobs-apply-header">Apply to Acme</h2><div class="progress" id="easy-apply-progress"><h3 id="easy-apply-step-title"></h3></div>
<div class="jobs-easy-apply-content" id="easy-apply-content"></div>
<footer><button type="button" class="artdeco-button artdeco-button--secondary" id="easy-apply-back" aria-label="Back to previous step">Back</button>
<button type="button" class="artdeco-button" id="easy-apply-next" aria-label="Continue to next step" data-easy-apply-next-button>Next</button>
<button type="button" class="artdeco-button" id="easy-apply-submit" aria-label="Submit application" data-live-test-easy-apply-submit-button>Submit application</button></footer></div></div>
<script>document.getElementById("jobs-apply-button-id").addEventListener("click", () => document.getElementById("easy-apply-overlay").classList.add("open"))
if (new URLSearchParams(location.search).get("open") === "1") document.getElementById("easy-apply-overlay").classList.add("open")</script>
${wizardScript({ mount: "#easy-apply-content", title: "#easy-apply-step-title", back: "#easy-apply-back", next: "#easy-apply-next", submit: "#easy-apply-submit", progress: "#easy-apply-progress", steps })}`,
  })
}

export function workday(switches: Switches): string {
  const id = (n: number): string => `input-${n}`
  const dd = (name: string, label: string, options: readonly string[], n: number, required = false): string =>
    `<div class="field" data-automation-id="formField-${name}"><label for="${id(n)}">${esc(label)}${required ? ' <span class="req">*</span>' : ""}</label>
<button type="button" id="${id(n)}" aria-haspopup="listbox" aria-expanded="false" ${required ? 'aria-required="true"' : ""} data-automation-id="${name}" data-for="${name}" data-options="${opts(options)}" aria-label="${esc(label)} ${required ? "Required" : ""}">Select One</button><input type="hidden" name="${name}"></div>`
  const text = (name: string, label: string, n: number, required = false, auto = ""): string =>
    `<div class="field" data-automation-id="formField-${name}"><label for="${id(n)}">${esc(label)}${required ? ' <span class="req">*</span>' : ""}</label>
<input type="text" id="${id(n)}" name="${name}" data-automation-id="${name}"${required ? ' required aria-required="true"' : ""}${auto ? ` autocomplete="${auto}"` : ""}></div>`
  const wall: Step | null = switches.wall
    ? {
        title: "Create Account",
        cta: "Create Account",
        html: `<p data-automation-id="createAccountHeading">Create an account to apply, or sign in if you already have one.</p>
<div class="field"><label for="${id(1)}">Email Address <span class="req">*</span></label><input type="text" id="${id(1)}" name="account_email" data-automation-id="email" required aria-required="true" autocomplete="username"></div>
<div class="field"><label for="${id(2)}">Password <span class="req">*</span></label><input type="password" id="${id(2)}" name="account_password" data-automation-id="password" required aria-required="true" autocomplete="new-password"></div>
<div class="field"><label for="${id(3)}">Verify New Password <span class="req">*</span></label><input type="password" id="${id(3)}" name="account_verify" data-automation-id="verifyPassword" required aria-required="true" autocomplete="new-password"></div>
<div class="field"><label class="check"><input type="checkbox" id="${id(4)}" name="create_account_consent" data-automation-id="createAccountCheckbox" required aria-required="true"> I have read and accept the Acme Privacy Notice.</label></div>`,
      }
    : null
  const steps: Step[] = [
    {
      title: "My Information",
      html: `${dd("source", "How Did You Hear About Us?", ["LinkedIn", "Referral", "Job board", "Other"], 10, true)}
${dd("country", "Country", COUNTRIES, 11, true)}
${text("legalNameSection_firstName", "Given Name(s)", 12, true, "given-name")}
${text("legalNameSection_lastName", "Family Name", 13, true, "family-name")}
${text("addressSection_addressLine1", "Address Line 1", 14, true, "address-line1")}
${text("addressSection_city", "City", 15, true, "address-level2")}
${text("addressSection_postalCode", "Postal Code", 16, true, "postal-code")}
${text("email", "Email", 17, true, "email")}
${dd("phone-device-type", "Phone Device Type", ["Mobile", "Home", "Work"], 18, true)}
${text("phone-number", "Phone Number", 19, true, "tel-national")}`,
    },
    {
      title: "My Experience",
      html: `<div class="field" data-automation-id="resumeSection"><label for="${id(20)}">Select Files</label><input type="file" id="${id(20)}" name="resume" data-automation-id="file-upload-input-ref"></div>
${text("linkedin", "LinkedIn Profile", 21)}
${text("website", "Website", 22)}`,
    },
    {
      title: "Application Questions",
      html: `${dd("authorized", "Are you legally authorized to work in the country of this job?", ["Yes", "No"], 30, true)}
${dd("sponsorship", "Will you now or in the future require sponsorship?", ["Yes", "No"], 31, true)}
<div class="field"><label for="${id(32)}">Why do you want to work at Acme?</label><textarea id="${id(32)}" name="why" data-automation-id="why" rows="4"></textarea></div>`,
    },
    {
      title: "Voluntary Disclosures",
      html: `<p>Acme is an equal opportunity employer. This information is voluntary.</p>
${dd("gender", "Gender", ["Male", "Female", "Non-binary", "I do not wish to answer"], 40)}
${dd("ethnicity", "Race/Ethnicity", ["Asian", "Black or African American", "Hispanic or Latino", "White", "I do not wish to answer"], 41)}
${dd("veteran", "Veteran Status", ["I am a protected veteran", "I am not a protected veteran", "I do not wish to answer"], 42)}
<div class="field"><label class="check"><input type="checkbox" id="${id(43)}" name="terms_conditions" data-automation-id="termsAndConditions"> I have read and consent to the terms and conditions.</label></div>`,
    },
    {
      title: "Self Identify",
      html: `<p>Voluntary self-identification of disability</p>
${dd("disability", "Disability status", ["Yes, I have a disability", "No, I do not have a disability", "I do not want to answer"], 50)}
${text("signature_name", "Name (signature)", 51)}
${text("signature_date", "Date", 52)}`,
    },
    { title: "Review", review: true, html: `<p>Review your application before you submit it.</p>{{review}}` },
  ]
  return shell({
    title: "Senior Engineer - Acme Careers",
    css: `.top { background: #0a3a6b; color: #fff; padding: 12px 16px; font-weight: 700 }
.field { margin: 14px 0; position: relative }
button[aria-haspopup=listbox] { display: block; width: 100%; text-align: left; padding: 8px; border: 1px solid #bbb; border-radius: 4px; background: #fff; font: inherit }
.progress { display: flex; gap: 8px; color: #555 }
.review-list { padding-left: 18px }`,
    body: `<div class="top">Acme Careers</div><main class="wrap" data-automation-id="applyFlowPage">
<h1 data-automation-id="jobPostingHeader">${esc(JOB.title)}</h1><p>${esc(JOB.location)}</p>
<section id="job-description" class="pg-job" data-automation-id="jobPostingDescription"><p>${esc(JOB.intro)}</p>${JOB.sections.map((section) => `<h3>${esc(section.heading)}</h3>${"text" in section ? `<p>${esc(section.text)}</p>` : `<ul>${section.list.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`}`).join("")}</section>
<div data-automation-id="progressBar" id="wd-progress"><h2 id="wd-step-title" data-automation-id="applyFlowStepTitle"></h2></div>
<div id="wd-content" data-automation-id="applyFlowContent"></div>
<footer><button type="button" class="btn secondary" id="wd-back" data-automation-id="bottom-navigation-back-button">Back</button>
<button type="button" class="btn" id="wd-next" data-automation-id="bottom-navigation-next-button">Save and Continue</button>
<button type="button" class="btn" id="wd-submit" data-automation-id="bottom-navigation-submit-button">Submit</button></footer></main>
${wizardScript({ mount: "#wd-content", title: "#wd-step-title", back: "#wd-back", next: "#wd-next", submit: "#wd-submit", progress: "#wd-progress", steps, wall })}`,
  })
}
