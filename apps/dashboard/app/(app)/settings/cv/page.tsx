import { nextEnv } from "@skiffr/env/next"
import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { CvSettings } from "@/components/cv-settings"
import { PageHeader } from "@/components/page-header"
import { getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "CV" }

const DOCS_FALLBACK = "https://github.com/FindMalek/skiffr/blob/main/apps/docs/content/docs/cv-tailoring.mdx"

export default async function CvPage() {
  const { DOCS_URL } = nextEnv()
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery(serverOrpc.cv.status.queryOptions())
  return (
    <>
      <PageHeader title="CV" description="Tailor your Reactive Resume to a job, without adding a single new fact." />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <CvSettings docsUrl={DOCS_URL ? `${DOCS_URL}/docs/cv-tailoring` : DOCS_FALLBACK} />
      </HydrationBoundary>
    </>
  )
}
