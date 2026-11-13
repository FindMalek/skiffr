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
  /** Needed by `/inspect`, `/admin` and the submissions listing: header `x-playground-token`, the cookie it sets, or `?token=` once. */
  token: string | null
  /** Production or a public host: the protected routes refuse everybody until a token is set. */
  locked: boolean
  /** Bytes a request body may have. */
  maxBody: number
  /** Per address: a burst of this many writes, then `ratePerMinute` more every minute. */
  rateBurst: number
  ratePerMinute: number
  /** How many proxies append to `x-forwarded-for` in front of the app. 0 ignores the header and uses the socket address. */
  trustedProxies: number
  /** Page analytics for the index, inspect and admin pages only: the board replicas never load a tracker. */
  umami: { scriptUrl: string; websiteId: string } | null
}

type Env = Record<string, string | undefined>

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)$/i

const count = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return value !== undefined && value !== "" && Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback
  return /^(1|true|yes|on)$/i.test(value)
}

export function readConfig(env: Env = process.env): Config {
  const port = Number(env.PORT ?? 3004)
  const publicUrl = new URL(env.PLAYGROUND_URL || `http://playground.localhost:${port}`)
  return {
    port,
    publicUrl,
    subdomains: flag(env.PLAYGROUND_SUBDOMAINS, true),
    fixturesDir: env.PLAYGROUND_FIXTURES_DIR || join(HERE, "..", "..", "e2e", "pages"),
    maxSubmissions: Number(env.PLAYGROUND_MAX_SUBMISSIONS ?? 100),
    token: env.PLAYGROUND_TOKEN || null,
    locked: env.NODE_ENV === "production" || !LOCAL_HOST.test(publicUrl.hostname),
    maxBody: count(env.PLAYGROUND_MAX_BODY, 1_000_000),
    rateBurst: count(env.PLAYGROUND_RATE_BURST, 20),
    ratePerMinute: count(env.PLAYGROUND_RATE_PER_MINUTE, 30),
    trustedProxies: count(env.TRUSTED_PROXY_COUNT, 0),
    umami:
      env.UMAMI_URL && env.UMAMI_WEBSITE_ID
        ? { scriptUrl: `${env.UMAMI_URL.replace(/\/+$/, "")}/script.js`, websiteId: env.UMAMI_WEBSITE_ID }
        : null,
  }
}
