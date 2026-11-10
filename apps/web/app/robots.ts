import type { MetadataRoute } from "next"
import { isIndexable, siteUrl } from "@/lib/seo"

export const dynamic = "force-dynamic"

export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) return { rules: { userAgent: "*", disallow: "/" } }
  const sitemap = [`${siteUrl()}/sitemap.xml`]
  if (process.env.DOCS_URL) sitemap.push(`${process.env.DOCS_URL.replace(/\/$/, "")}/sitemap.xml`)
  return { rules: { userAgent: "*", allow: "/" }, sitemap }
}
