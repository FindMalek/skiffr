import type { Config } from "./config.ts"
import { siteUrl } from "./hosts.ts"
import { esc } from "./html.ts"
import { page } from "./pages/chrome.ts"
import { SITES } from "./sites.ts"

export function indexPage(config: Config): string {
  const rows = SITES.map((site) => {
    const url = siteUrl(config, site)
    const extras = (site.extra ?? [])
      .map((extra) => `<a href="${esc(siteUrl(config, site, extra.query))}">${esc(extra.label)}</a>`)
      .join(" ")
    const real = site.hosts[0] ? `<div class="small muted">real host <code>${esc(site.hosts[0])}</code></div>` : ""
    return `<tr id="${esc(site.id)}" data-site="${esc(site.id)}"><td><a href="${esc(url)}"><strong>${esc(site.name)}</strong></a>
<div class="small">${extras}</div></td><td>${esc(site.description)}<div class="small muted">${site.tests.map(esc).join(" · ")}</div></td>
<td class="small"><code>${esc(url)}</code>${real}${site.adapter ? '<div class="chip green">board adapter</div>' : ""}</td></tr>`
  }).join("")
  const body = `<h1>Test pages for autofill</h1>
<p>Fake application pages shaped like real ones. Fill them with the extension, press submit and read what happened on <a href="/inspect">inspect</a>. Nothing is sent anywhere else. Do not type real personal data or a real password. What you submit is kept in memory under a private run id and is read back through the link on the confirmation page.</p>
<h2>Switches</h2>
<table><tr><th>query</th><th>effect</th></tr>
<tr><td><code>?latency=1500</code></td><td>adds that many milliseconds to every timer that stands in for a network answer (async widgets, late mounts)</td></tr>
<tr><td><code>?cookie=1</code></td><td>shows a cookie banner over the lower left corner</td></tr>
<tr><td><code>?layout=b</code></td><td>reorders the fields, to emulate a layout change</td></tr>
<tr><td><code>?variant=renamed-ids|moved-fields|new-required-field</code></td><td>a changed markup variant of this one request, to simulate drift. <code>variant=none</code> overrides the <a href="/admin">break it</a> page</td></tr>
<tr><td><code>?run=abc</code></td><td>tags the submissions of one test run, so <code>/inspect?run=abc</code> only shows yours</td></tr></table>
<h2>Pages</h2>
<table><tr><th>page</th><th>what it tests</th><th>address</th></tr>${rows}</table>
<h2>For the seeder and scripts</h2>
<p><a href="/api/jobs"><code>GET /api/jobs</code></a> lists every page with the url the seeder should use. <code>GET /api/submissions?run=abc</code> returns the recorded submissions as JSON.</p>
<h2>Locally</h2>
<p>Start it with <code>pnpm --filter playground dev</code> (port 3004). Chrome resolves <code>*.localhost</code> by itself, so <code>http://greenhouse.playground.localhost:3004/</code> works as it is. To reach the real board host names, so the extension's host based detection runs, map them to this machine:</p>
<pre class="card">chrome --host-resolver-rules="MAP *.greenhouse.io 127.0.0.1, MAP jobs.lever.co 127.0.0.1, MAP jobs.ashbyhq.com 127.0.0.1, MAP apply.workable.com 127.0.0.1"</pre>
<p class="small muted">Some boards are https only in Chrome, so serve the app over https for those (the e2e does, with a throwaway certificate).</p>`
  return page("Skiffr playground", body, { umami: config.umami })
}
