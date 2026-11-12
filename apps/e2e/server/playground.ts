import { createApp } from "../../playground/src/app.ts"
import { readConfig } from "../../playground/src/config.ts"
import { listen } from "../../playground/src/node-server.ts"
import { SITE_BY_ID, SITES } from "../../playground/src/sites.ts"
import type { SubmissionStore } from "../../playground/src/submissions.ts"
import type { VariantState } from "../../playground/src/switches.ts"
import { throwawayCertificate } from "./fixture-server.ts"

/** Every real board host name a playground page answers to: a test maps them to loopback with a resolver rule. */
export const PLAYGROUND_REAL_HOSTS: string[] = [...new Set(SITES.flatMap((site) => site.hosts))]

export interface Playground {
  /** The index host, http. Pages live on `<site>.playground.localhost` of the same port, which Chrome resolves by itself. */
  origin: string
  store: SubmissionStore
  variants: VariantState
  /** A page on its subdomain over http: the extension sees no board host name, so only the generic path runs. */
  url: (site: string, query?: string) => string
  /** A page under its real board host name over https: the host based detection and the adapters run. Needs the resolver rules. */
  realUrl: (site: string, query?: string) => string
  stop: () => Promise<void>
}

export async function startPlayground(): Promise<Playground> {
  const config = readConfig({
    PORT: "0",
    PLAYGROUND_URL: "http://playground.localhost:3004",
    PLAYGROUND_RATE_BURST: "0",
  })
  // never the exporters of a developer's environment: a test run must not send events to a real Umami or GlitchTip
  const quiet = {
    sendUmamiEvent: async () => ({ sent: false as const, reason: "disabled" as const }),
    captureException: async () => ({ sent: false as const, reason: "disabled" as const }),
  }
  const { handle, store, variants } = createApp({ config, telemetry: quiet })
  const http = await listen(handle, { port: 0 })
  const https = await listen(handle, { port: 0, tls: throwawayCertificate() })
  config.publicUrl = new URL(`http://playground.localhost:${http.port}`)

  const withQuery = (path: string, query?: string): string =>
    query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path
  return {
    origin: config.publicUrl.origin,
    store,
    variants,
    url: (site, query) => {
      const entry = SITE_BY_ID.get(site)
      if (!entry) throw new Error(`no playground page ${site}`)
      return `http://${site}.playground.localhost:${http.port}${withQuery(entry.jobPath, query)}`
    },
    realUrl: (site, query) => {
      const entry = SITE_BY_ID.get(site)
      const host = entry?.hosts[0]
      if (!entry || !host) throw new Error(`playground page ${site} has no real host`)
      return `https://${host}:${https.port}${withQuery(entry.jobPath, query)}`
    },
    stop: async () => {
      await Promise.all([http.close(), https.close()])
    },
  }
}
