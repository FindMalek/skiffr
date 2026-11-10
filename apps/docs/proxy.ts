import { isMarkdownPreferred } from "fumadocs-core/negotiation"
import { type NextRequest, NextResponse } from "next/server"

/** `Accept: text/markdown` on a docs url answers with the page markdown. */
export default function proxy(request: NextRequest) {
  if (!isMarkdownPreferred(request)) return NextResponse.next({ headers: { Vary: "Accept" } })
  const rest = request.nextUrl.pathname.slice("/docs".length).replace(/\/$/, "")
  return NextResponse.rewrite(new URL(`/llms.mdx${rest || "/index"}`, request.nextUrl), {
    headers: { Vary: "Accept" },
  })
}

export const config = { matcher: ["/docs", "/docs/:path*"] }
