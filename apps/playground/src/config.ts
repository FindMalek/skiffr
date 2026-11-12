import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

export interface Config {
  port: number
  /** Public address of the index host. Site hosts are `<site>.<this host>` when subdomains are on. */
  publicUrl: URL
  subdomains: boolean
  /** Shared fixtures of the e2e app: the faithful board pages and `shared/widgets.js`. */
  fixturesDir: string
  maxSubmissions: number
  /** When set, `/inspect` and `/admin` need it as `?token=` or an `x-playground-token` header. */
  token: string | null
  /** Page analytics for the index, inspect and admin pages only: the board replicas never load a tracker. */
  umami: { scriptUrl: string; websiteId: string } | null
}

type Env = Record<string, string | undefined>

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback
  return /^(1|true|yes|on)$/i.test(value)
}

export function readConfig(env: Env = process.env): Config {
  const port = Number(env.PORT ?? 3004)
  return {
    port,
    publicUrl: new URL(env.PLAYGROUND_URL || `http://playground.localhost:${port}`),
    subdomains: flag(env.PLAYGROUND_SUBDOMAINS, true),
    fixturesDir: env.PLAYGROUND_FIXTURES_DIR || join(HERE, "..", "..", "e2e", "pages"),
    maxSubmissions: Number(env.PLAYGROUND_MAX_SUBMISSIONS ?? 100),
    token: env.PLAYGROUND_TOKEN || null,
    umami:
      env.UMAMI_URL && env.UMAMI_WEBSITE_ID
        ? { scriptUrl: `${env.UMAMI_URL.replace(/\/+$/, "")}/script.js`, websiteId: env.UMAMI_WEBSITE_ID }
        : null,
  }
}
