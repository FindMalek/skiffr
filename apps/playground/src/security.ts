import type { Config } from "./config.ts"

/** On every response: nobody should index a fake job board, sniff its types or learn a token from a referrer. */
export const BASE_HEADERS: Record<string, string> = {
  "x-robots-tag": "noindex, nofollow, noarchive",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
}

export const ROBOTS = "User-agent: *\nDisallow: /\n"

/** The index, inspect, admin and confirmation pages: no script of our own, the Umami origin when it is set, no framing. */
export function staticCsp(config: Config): string {
  const umami = config.umami ? new URL(config.umami.scriptUrl).origin : ""
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src ${umami || "'none'"}`,
    `connect-src ${umami || "'none'"}`,
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ")
}

/**
 * The replica pages run their own inline scripts, so the policy is about what leaves: a form may only post to its own
 * host and the page may only be framed by itself, or, for the embed frame, by the company page that holds it.
 */
export function pageCsp(frameAncestors: string[]): string {
  return `form-action 'self'; base-uri 'self'; frame-ancestors 'self'${frameAncestors.length ? ` ${frameAncestors.join(" ")}` : ""}`
}
