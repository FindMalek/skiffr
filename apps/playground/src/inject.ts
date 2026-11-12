import { JOB } from "./fields.ts"
import { esc } from "./html.ts"
import type { Site } from "./sites.ts"
import type { Switches } from "./switches.ts"

/** The posting every page shows above or beside its form. Neutral text: nothing is copied from a real company. */
export function jobDescription(): string {
  const sections = JOB.sections
    .map((section) => {
      const body =
        "text" in section
          ? `<p>${esc(section.text)}</p>`
          : `<ul>${section.list.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`
      return `<h3>${esc(section.heading)}</h3>${body}`
    })
    .join("")
  return (
    `<section id="job-description" class="pg-job" style="max-width:640px;margin:0 auto;padding:16px;font:15px/1.5 system-ui,sans-serif;color:#222">` +
    `<h2 style="margin:0 0 4px">${esc(JOB.title)} at ${esc(JOB.company)}</h2>` +
    `<p style="margin:0 0 8px;color:#555">${esc(JOB.location)}</p><p>${esc(JOB.intro)}</p>${sections}</section>`
  )
}

export interface InjectOptions {
  site: Site
  switches: Switches
  /** The page draws its own description. */
  hasJob?: boolean
}

const SECURITY = "form-action 'self'; base-uri 'self'"

export const PAGE_HEADERS: Record<string, string> = { "content-security-policy": SECURITY }

function pgConfig({ site, switches }: InjectOptions): string {
  const cfg = {
    site: site.id,
    latency: switches.latency || "",
    cookie: switches.cookie ? "1" : "",
    layout: switches.layout === "b" ? "b" : "",
    variant: switches.variant ?? "",
    run: switches.run,
    bare: switches.bare ? "1" : "",
  }
  return `<script>window.__PG=${JSON.stringify(cfg).replace(/</g, "\\u003c")}</script><script src="/pg.js"></script>`
}

/**
 * Turns a page into a playground page: the board's own `/submit` endpoint becomes ours, the switches and the
 * submit capture are loaded first, and the job description is added where a real board shows one.
 */
export function finalize(html: string, options: InjectOptions): string {
  let page = html
    .replace(/action="\/submit\?[^"]*"/g, 'action="/api/submissions"')
    .replace(/(<form\b[^>]*?)\bmethod="get"/gi, '$1method="post"')
  const head = pgConfig(options)
  page = /<head[^>]*>/i.test(page) ? page.replace(/<head[^>]*>/i, (open) => `${open}${head}`) : `${head}${page}`
  if (!options.hasJob) page = page.replace(/<body[^>]*>/i, (open) => `${open}${jobDescription()}`)
  return page
}
