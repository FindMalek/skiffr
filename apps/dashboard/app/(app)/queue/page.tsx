import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { QueueBoard } from "@/components/queue/queue-board"
import { getQueryClient, serverOrpc } from "@/lib/api"
import { DEFAULT_FILTERS, listInput } from "@/lib/queue"

export const metadata: Metadata = { title: "Queue" }

/**
 * The board, its counts and the "Open next" button all read these three queries, so the whole page (header included)
 * sits inside the boundary and nothing is fetched again on the client. Never the job urls themselves.
 */
export default async function QueuePage() {
  const queryClient = getQueryClient()
  await Promise.all([
    queryClient.prefetchQuery(serverOrpc.jobs.list.queryOptions({ input: listInput(DEFAULT_FILTERS) })),
    queryClient.prefetchQuery(serverOrpc.jobs.counts.queryOptions()),
    queryClient.prefetchQuery(serverOrpc.jobs.next.queryOptions()),
  ])
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <QueueBoard />
    </HydrationBoundary>
  )
}
