import type { Config } from "./config.ts"
import { SITE_BY_ID, SITES, type Site } from "./sites.ts"

export type Route = { kind: "index" } | { kind: "site"; site: Site; viaPath: boolean }

const PATH_PREFIX = /^\/s\/([a-z0-9-]+)(\/.*)?$/

export const hostnameOf = (hostHeader: string | null): string =>
  (hostHeader ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")

/**
 * Which page a request is for, from the Host header:
 *  - a real board host name (`job-boards.greenhouse.io`) reached through a resolver rule or a proxy,
 *  - `<site>.<index host>` (`greenhouse.playground.localhost`),
 *  - the index host itself, where `/s/<site>/...` reaches every page without a wildcard name.
 */
export function routeFor(config: Config, hostHeader: string | null, pathname: string): { route: Route; path: string } {
  const host = hostnameOf(hostHeader)
  const sharing = SITES.filter((site) => site.hosts.includes(host))
  const real = sharing.find((site) => site.claims?.(pathname) ?? true) ?? sharing[0]
  if (real) return { route: { kind: "site", site: real, viaPath: false }, path: pathname }

  const apex = config.publicUrl.hostname.toLowerCase()
  if (host.endsWith(`.${apex}`)) {
    const site = SITE_BY_ID.get(host.slice(0, -apex.length - 1))
    if (site) return { route: { kind: "site", site, viaPath: false }, path: pathname }
  }
  const viaPath = PATH_PREFIX.exec(pathname)
  const site = viaPath ? SITE_BY_ID.get(viaPath[1] as string) : undefined
  if (site) return { route: { kind: "site", site, viaPath: true }, path: viaPath?.[2] || "/" }
  return { route: { kind: "index" }, path: pathname }
}

export interface JobLink {
  site: string
  name: string
  url: string
  /** The address on a real board host name, for runs with a resolver rule. */
  realUrl: string | null
}

/** Where a page lives for the outside: a subdomain of the index host, or `/s/<site>` when there is no wildcard name. */
export function siteUrl(config: Config, site: Site, query = ""): string {
  const base = config.publicUrl
  const suffix = `${site.jobPath}${query ? `${site.jobPath.includes("?") ? "&" : "?"}${query}` : ""}`
  if (config.subdomains) return `${base.protocol}//${site.id}.${base.host}${suffix}`
  return `${base.origin}/s/${site.id}${suffix}`
}

export function jobLinks(config: Config): JobLink[] {
  return SITES.map((site) => ({
    site: site.id,
    name: site.name,
    url: siteUrl(config, site),
    realUrl: site.hosts[0] ? `https://${site.hosts[0]}${site.jobPath}` : null,
  }))
}
