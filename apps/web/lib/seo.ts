import { SITE } from "./site"

/** The public origin, read per request so one build serves every environment. */
export function siteUrl(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "")
}

/** The repo's public url. `GITHUB_REPO` (owner/name) overrides the default for forks. */
export function repoUrl(): string {
  const repo = process.env.GITHUB_REPO
  return repo ? `https://github.com/${repo}` : SITE.repo
}

/** The docs site, read per request. Localhost is only a development fallback: a production deploy without `DOCS_URL` has none. */
function docsOrigin(): string | null {
  const url = process.env.DOCS_URL
  if (url) return url.replace(/\/$/, "")
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3003"
}

/** A docs page: on the docs site when it is configured, else its source file in the repo, so a link never points at localhost. */
export function docsHref(slug = ""): string {
  const origin = docsOrigin()
  if (origin) return `${origin}/docs${slug ? `/${slug}` : ""}`
  return `${repoUrl()}/blob/main/apps/docs/content/docs/${slug || "index"}.mdx`
}

/** Previews and local runs stay out of search results. */
export function isIndexable(): boolean {
  return !process.env.DEPLOY_ENV?.startsWith("pr-") && new URL(siteUrl()).hostname !== "localhost"
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl()}/#website`,
        url: siteUrl(),
        name: SITE.name,
        description: SITE.tagline,
      },
      { "@type": "Organization", "@id": `${siteUrl()}/#organization`, url: siteUrl(), name: SITE.name },
    ],
  }
}
