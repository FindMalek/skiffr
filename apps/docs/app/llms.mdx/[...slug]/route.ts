import { notFound } from "next/navigation"
import { findPage, renderPageMarkdown } from "@/lib/llms"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const page = findPage(slug)
  if (!page) notFound()
  return new Response(await renderPageMarkdown(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" },
  })
}
