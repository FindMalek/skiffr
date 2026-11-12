import { nextEnv } from "@skiffr/env/next"
import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { SourceSettings } from "@/components/source-settings"
import { getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "Sources" }

const DOCS_FALLBACK = "https://github.com/FindMalek/skiffr/blob/main/apps/docs/content/docs/sources.mdx"

export default async function SourcesPage() {
  const { DOCS_URL } = nextEnv()
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery(serverOrpc.jobSources.list.queryOptions({ input: {} }))
  return (
    <>
      <PageHeader title="Sources" description="Watch careers pages and feeds. New postings land in your queue." />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <SourceSettings docsUrl={DOCS_URL ? `${DOCS_URL}/docs/sources` : DOCS_FALLBACK} />
      </HydrationBoundary>
    </>
  )
}
