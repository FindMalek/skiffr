import type { MetadataRoute } from "next"
import { siteUrl } from "@/lib/seo"

export const dynamic = "force-dynamic"

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/"]
  return paths.map((path) => ({
    url: `${siteUrl()}${path === "/" ? "" : path}`,
  }))
}
