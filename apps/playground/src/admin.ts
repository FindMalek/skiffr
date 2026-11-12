import { esc } from "./html.ts"
import { type PageOptions, page } from "./pages/chrome.ts"
import { SITES } from "./sites.ts"
import { VARIANTS, type VariantState } from "./switches.ts"

const BLURB: Record<string, string> = {
  "renamed-ids": "every id and name gets a suffix, labels and aria references follow",
  "moved-fields": "the fields change order, the way a redesign moves them",
  "new-required-field": "a new required question appears before the submit button",
}

/** Flips a page into a changed markup, so a person or a test can see whether detection and fill notice the drift. */
export function adminPage(variants: VariantState, options: PageOptions = {}): string {
  const token = options.token ?? ""
  const hidden = token ? `<input type="hidden" name="token" value="${esc(token)}">` : ""
  const rows = SITES.map((site) => {
    const current = variants.get(site.id)
    const buttons = [null, ...VARIANTS]
      .map((variant) => {
        const on = variant === current
        return `<form class="inline" method="post" action="/admin/variant"><input type="hidden" name="site" value="${esc(site.id)}"><input type="hidden" name="variant" value="${esc(variant ?? "none")}">${hidden}<button${on ? ' disabled aria-pressed="true"' : ""} data-site="${esc(site.id)}" data-variant="${esc(variant ?? "none")}">${esc(variant ?? "original")}</button></form>`
      })
      .join(" ")
    return `<tr><td><strong>${esc(site.name)}</strong> <code>${esc(site.id)}</code></td><td>${current ? `<span class="chip amber">${esc(current)}</span>` : '<span class="chip green">original</span>'}</td><td>${buttons}</td></tr>`
  }).join("")
  const body = `<h1>Break it</h1>
<p>Switch a page to a changed variant and run autofill again. The variant stays until you switch it back or restart the server. A request with <code>?variant=none</code> always gets the original.</p>
<ul>${VARIANTS.map((variant) => `<li><code>${variant}</code>: ${BLURB[variant]}</li>`).join("")}</ul>
<form method="post" action="/admin/reset">${hidden}<button>restore every page</button></form>
<table><tr><th>page</th><th>now</th><th>switch to</th></tr>${rows}</table>`
  return page("Break it - skiffr playground", body, options)
}
