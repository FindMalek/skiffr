import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Config } from "./config.ts"
import { BOARD_PAGES } from "./pages/boards.ts"
import { embedParent, honeypot, react, shadow, vue } from "./pages/frameworks.ts"
import { linkedin, workday } from "./pages/wizards.ts"
import { SITE_BY_ID, type Site } from "./sites.ts"
import type { Switches } from "./switches.ts"

export interface RenderContext {
  config: Config
  site: Site
  switches: Switches
  /** Scheme, host and port the visitor used. */
  origin: URL
  viaPath: boolean
}

export interface Rendered {
  html: string
  /** The page shows its own description. */
  hasJob: boolean
}

/** The faithful board pages the e2e app keeps: the playground serves them as they are, with its own submit and switches on top. */
const FIXTURES: Record<string, string> = {
  greenhouse: "adapters/greenhouse.html",
  "greenhouse-legacy": "ats/greenhouse.html",
  "embed-frame": "ats/greenhouse.html",
  lever: "adapters/lever.html",
  ashby: "adapters/ashby.html",
  workable: "adapters/workable.html",
}

/** The second host of the iframe embed: another real name, another subdomain, or the same origin when there is no wildcard name. */
export function embedFrameUrl(ctx: RenderContext): string {
  const frame = SITE_BY_ID.get("embed-frame") as Site
  const { origin, config } = ctx
  const forward = new URLSearchParams()
  if (ctx.switches.run) forward.set("run", ctx.switches.run)
  if (ctx.switches.variant) forward.set("variant", ctx.switches.variant)
  if (ctx.switches.latency) forward.set("latency", String(ctx.switches.latency))
  const query = forward.toString()
  const path = `${frame.jobPath}${query ? `&${query}` : ""}`
  const port = origin.port ? `:${origin.port}` : ""
  if (ctx.viaPath) return `${origin.origin}/s/embed-frame${path}`
  const apex = config.publicUrl.hostname
  const host = origin.hostname.endsWith(`.${apex}`) ? `embed-frame.${apex}` : (frame.hosts[0] as string)
  return `${origin.protocol}//${host}${port}${path}`
}

async function fixture(config: Config, name: string): Promise<string> {
  return readFile(join(config.fixturesDir, name), "utf8")
}

export async function renderSite(ctx: RenderContext): Promise<Rendered | null> {
  const { site } = ctx
  const file = FIXTURES[site.id]
  if (file) return { html: await fixture(ctx.config, file), hasJob: false }
  const page = BOARD_PAGES[site.id]
  if (page) return { html: page(), hasJob: true }
  switch (site.id) {
    case "linkedin":
      return { html: linkedin(), hasJob: true }
    case "workday":
      return { html: workday(ctx.switches), hasJob: true }
    case "react":
      return { html: react(), hasJob: true }
    case "vue":
      return { html: vue(), hasJob: true }
    case "shadow":
      return { html: shadow(), hasJob: true }
    case "honeypot":
      return { html: honeypot(), hasJob: true }
    case "embed":
      return { html: embedParent(embedFrameUrl(ctx)), hasJob: true }
    default:
      return null
  }
}
