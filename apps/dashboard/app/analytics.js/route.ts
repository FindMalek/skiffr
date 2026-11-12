import { nextEnv } from "@skiffr/env/next"
import { umamiResponse } from "@skiffr/observability/umami"

// Read per request, so the site id is runtime config and is never baked into the build.
export const dynamic = "force-dynamic"

export function GET() {
  const { UMAMI_URL, UMAMI_WEBSITE_ID } = nextEnv()
  return umamiResponse(UMAMI_URL, UMAMI_WEBSITE_ID)
}
