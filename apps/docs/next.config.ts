import { fileURLToPath } from "node:url"
import { loadEnvConfig } from "@next/env"
import { createMDX } from "fumadocs-mdx/next"
import type { NextConfig } from "next"

const root = fileURLToPath(new URL("../../", import.meta.url))
loadEnvConfig(root)

/** Baseline security headers; tighten the CSP once the docs load third parties. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
]

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  transpilePackages: ["@skiffr/ui", "@skiffr/observability"],
  poweredByHeader: false,
  reactStrictMode: true,
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
  // `<page>.md` and `<page>.mdx` are served by app/llms.mdx, Accept negotiation lives in proxy.ts
  async rewrites() {
    return [
      { source: "/docs/:path*.md", destination: "/llms.mdx/:path*" },
      { source: "/docs/:path*.mdx", destination: "/llms.mdx/:path*" },
    ]
  },
}

export default createMDX()(nextConfig)
