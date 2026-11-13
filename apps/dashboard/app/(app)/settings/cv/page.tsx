import { nextEnv } from "@skiffr/env/next"
import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { CvSettings } from "@/components/cv-settings"
import { getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "Resume" }

const DOCS_FALLBACK = "https://github.com/FindMalek/skiffr/blob/main/apps/docs/content/docs/cv-tailoring.mdx"

export default async function CvPage() {
  const { DOCS_URL } = nextEnv()
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery(serverOrpc.cv.status.queryOptions())
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CvSettings docsUrl={DOCS_URL ? `${DOCS_URL}/docs/cv-tailoring` : DOCS_FALLBACK} />
    </HydrationBoundary>
  )
}
