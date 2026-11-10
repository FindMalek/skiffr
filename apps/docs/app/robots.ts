import type { MetadataRoute } from "next"

export const dynamic = "force-dynamic"

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.DOCS_URL ?? "http://localhost:3003").replace(/\/$/, "")
  const indexable = !process.env.DEPLOY_ENV?.startsWith("pr-") && new URL(base).hostname !== "localhost"
  return indexable
    ? { rules: { userAgent: "*", allow: "/" }, sitemap: `${base}/sitemap.xml` }
    : { rules: { userAgent: "*", disallow: "/" } }
}
