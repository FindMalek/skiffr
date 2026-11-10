import type { MetadataRoute } from "next"
import { markdownPath } from "@/lib/llms"
import { source } from "@/lib/source"

export const dynamic = "force-dynamic"

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.DOCS_URL ?? "http://localhost:3003").replace(/\/$/, "")
  return [
    { url: base },
    ...source
      .getPages()
      .flatMap((page) => [{ url: `${base}${page.url}` }, { url: `${base}${markdownPath(page.url)}` }]),
    { url: `${base}/llms.txt` },
    { url: `${base}/llms-full.txt` },
  ]
}
