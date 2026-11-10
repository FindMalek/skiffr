import type { MetadataRoute } from "next"

/** Everything behind or around the login stays out of search results. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } }
}
