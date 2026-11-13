import { fileURLToPath } from "node:url"
import { loadEnvConfig } from "@next/env"
import type { NextConfig } from "next"

const root = fileURLToPath(new URL("../../", import.meta.url))
// One .env at the repo root for every app.
loadEnvConfig(root)

/** Baseline security headers; tighten the CSP per project once its third parties are known. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
]

const transpilePackages = ["@skiffr/ui", "@skiffr/orpc", "@skiffr/common", "@skiffr/ai", "@skiffr/observability"]

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  transpilePackages,
  poweredByHeader: false,
  typedRoutes: true,
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
}

const plugins: Array<(config: NextConfig) => NextConfig> = []

export default plugins.reduce((config, plugin) => plugin(config), nextConfig)
