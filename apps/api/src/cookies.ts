const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

export type CookiePolicy = { secure: boolean; warning?: string }

/**
 * Session cookies are Secure in production, unless the dashboard is reached over plain http on purpose. That is only right for a
 * loopback address (the self-host stack on localhost, where browsers refuse Secure cookies on http). Fails closed: production
 * without `DASHBOARD_URL` does not start, and an http url that is not loopback is Secure-less with a loud warning.
 * `dashboardUrl` is the raw env value, not the schema default.
 */
export function cookiePolicy(opts: { nodeEnv: string; dashboardUrl: string | undefined }): CookiePolicy {
  if (opts.nodeEnv !== "production") return { secure: false }
  if (!opts.dashboardUrl) {
    throw new Error("DASHBOARD_URL is not set: in production it must be the public https url of the dashboard")
  }
  let url: URL
  try {
    url = new URL(opts.dashboardUrl)
  } catch {
    throw new Error(`DASHBOARD_URL is not a valid url: ${opts.dashboardUrl}`)
  }
  if (url.protocol === "https:") return { secure: true }
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return { secure: false }
  return {
    secure: false,
    warning: `session cookies are not Secure because DASHBOARD_URL is ${url.protocol}//${url.host}: use https, or a proxy that terminates tls and an https DASHBOARD_URL`,
  }
}
