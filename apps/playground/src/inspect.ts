import { esc } from "./html.ts"
import { type PageOptions, page } from "./pages/chrome.ts"
import { SITE_BY_ID } from "./sites.ts"
import { isRed, type Submission } from "./submissions.ts"

const FLAG_TEXT: Record<string, { text: string; cls: string }> = {
  "sensitive-touched": { text: "sensitive field was filled", cls: "red" },
  "trap-touched": { text: "hidden trap was filled", cls: "red" },
  "required-empty": { text: "required, left empty", cls: "amber" },
}

function fieldRow(field: Submission["fields"][number]): string {
  const flag = field.flag ? FLAG_TEXT[field.flag] : null
  const status = flag
    ? `<span class="chip ${flag.cls}">${flag.text}</span>`
    : field.filled
      ? '<span class="chip green">filled</span>'
      : '<span class="chip">empty</span>'
  const kind = [
    field.type,
    field.sensitive ? "sensitive" : "",
    field.trap ? "trap" : "",
    field.visible ? "" : "not visible",
  ]
    .filter(Boolean)
    .join(", ")
  return `<tr><td>${esc(field.label || field.name || field.id)}</td><td class="small muted">${esc(kind)}</td><td><code>${esc(field.name || field.id)}</code></td><td>${esc(field.value)}</td><td>${status}</td></tr>`
}

function submissionCard(submission: Submission): string {
  const site = SITE_BY_ID.get(submission.site)
  const { counts } = submission
  const red = isRed(submission)
  const tags = [
    submission.run ? `run <code>${esc(submission.run)}</code>` : "",
    submission.variant ? `variant <code>${esc(submission.variant)}</code>` : "",
    submission.layout === "b" ? "layout b" : "",
    submission.cookie ? "cookie banner" : "",
    submission.latency ? `latency ${submission.latency} ms` : "",
  ].filter(Boolean)
  return `<section class="card" id="s-${esc(submission.id)}" data-submission="${esc(submission.id)}" data-red="${red}">
<h2 style="margin-top:0">${esc(site?.name ?? submission.site)} <span class="muted small">${esc(submission.at)} on ${esc(submission.host)}</span></h2>
<p>${red ? `<span class="chip red">guard failed: ${counts.sensitiveTouched} sensitive, ${counts.trapTouched} trap</span> ` : '<span class="chip green">guard held</span> '}
<span class="chip">${counts.filled} filled</span> <span class="chip">${counts.empty} empty</span>${counts.requiredEmpty ? ` <span class="chip amber">${counts.requiredEmpty} required left empty</span>` : ""}
${tags.map((tag) => `<span class="chip">${tag}</span>`).join(" ")}</p>
<table><tr><th>field</th><th>kind</th><th>name</th><th>value</th><th>status</th></tr>${submission.fields.map(fieldRow).join("")}</table>
${submission.fields.length === 0 ? '<p class="muted">The page reported no controls. The raw post is below.</p>' : ""}
<details><summary class="small">raw post (${submission.posted.length} entries)</summary><table>${submission.posted.map((item) => `<tr><td><code>${esc(item.name)}</code></td><td>${esc(item.value)}</td></tr>`).join("")}</table></details></section>`
}

export function inspectPage(
  submissions: Submission[],
  filter: { run: string; site: string },
  options: PageOptions = {},
): string {
  const token = options.token ?? ""
  const red = submissions.filter(isRed)
  const banner = red.length
    ? `<div class="banner red" role="alert" data-guard="failed"><strong>guard failed</strong> in ${red.length} submission${red.length === 1 ? "" : "s"}: a sensitive field or a hidden trap holds a value. If you did not type it yourself, autofill touched it.</div>`
    : submissions.length
      ? '<div class="banner" style="background:#e9f6ea;border:1px solid #9bd0a0" data-guard="held">No sensitive field or trap holds a value.</div>'
      : ""
  const body = `<h1>Submissions</h1>
<p class="muted">The last ${submissions.length} in memory${filter.run ? ` for run <code>${esc(filter.run)}</code>` : ""}${filter.site ? ` on <code>${esc(filter.site)}</code>` : ""}. Nothing here leaves this server and a restart clears it.</p>
${banner}
<form method="get" action="/inspect" class="small">run <input name="run" value="${esc(filter.run)}" size="12"> site <input name="site" value="${esc(filter.site)}" size="12">${token ? `<input type="hidden" name="token" value="${esc(token)}">` : ""} <button>filter</button></form>
${submissions.length ? submissions.map(submissionCard).join("") : '<p class="card">No submission yet. Fill a page and press its submit button.</p>'}`
  return page("Inspect - skiffr playground", body, options)
}
