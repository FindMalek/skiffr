import { renderFull } from "@/lib/llms"

export const dynamic = "force-dynamic"

export async function GET() {
  return new Response(await renderFull(), { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
