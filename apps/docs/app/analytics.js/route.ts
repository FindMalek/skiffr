import { umamiResponse } from "@skiffr/observability/umami"

// Read per request, so the site id is runtime config and is never baked into the build.
export const dynamic = "force-dynamic"

export function GET() {
  return umamiResponse(process.env.UMAMI_URL, process.env.UMAMI_WEBSITE_ID)
}
