import { renderIndex } from "@/lib/llms"

// DOCS_URL is read at run time, like the sitemap
export const dynamic = "force-dynamic"

export function GET() {
  return new Response(renderIndex(), { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
