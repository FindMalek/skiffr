export const PROJECT = "skiffr"
export const POSTGRES = { name: "skiffr-db", database: "skiffr", user: "skiffr", image: "pgvector/pgvector:pg17" }
export const IMAGE_PREFIX = process.env.IMAGE_PREFIX || "ghcr.io/findmalek/skiffr"

/** `host` is the subdomain under PRODUCTION_DOMAIN, empty for the landing page. `path` is what the smoke check requests. */
export const APPS = [
  { key: "api", port: 3001, host: "api", path: "/health" },
  { key: "web", port: 3000, host: "", path: "/" },
  { key: "dashboard", port: 3002, host: "dashboard", path: "/login" },
  { key: "docs", port: 3003, host: "docs", path: "/docs" },
]

export const appName = (key) => `skiffr-${key}`
export const imageFor = (key, tag) => `${IMAGE_PREFIX}-${key}:${tag}`

export function hostsFor(domain) {
  const base = String(domain).replace(/^\.+|\.+$/g, "")
  return Object.fromEntries(APPS.map(({ key, host }) => [key, host ? `${host}.${base}` : base]))
}
