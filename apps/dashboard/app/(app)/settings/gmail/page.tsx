import { nextEnv } from "@skiffr/env/next"
import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { GmailSettings } from "@/components/gmail-settings"
import { getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "Gmail alerts" }

const DOCS_FALLBACK = "https://github.com/FindMalek/skiffr/blob/main/apps/docs/content/docs/gmail.mdx"

export default async function GmailPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const { gmail } = await searchParams
  const { DOCS_URL } = nextEnv()
  const queryClient = getQueryClient()
  await Promise.all([
    queryClient.prefetchQuery(serverOrpc.gmail.status.queryOptions()),
    queryClient.prefetchQuery(serverOrpc.gmail.senders.list.queryOptions()),
    queryClient.prefetchQuery(serverOrpc.gmail.recent.queryOptions({ input: {} })),
  ])
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <GmailSettings notice={gmail ?? null} docsUrl={DOCS_URL ? `${DOCS_URL}/docs/gmail` : DOCS_FALLBACK} />
    </HydrationBoundary>
  )
}
