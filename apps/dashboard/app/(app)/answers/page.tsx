import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { AnswerBank } from "@/components/answers/answer-bank"
import { AddAnswerDialog } from "@/components/answers/answer-dialogs"
import { STATS_LIMIT } from "@/components/answers/stats-limit"
import { StatsStrip } from "@/components/answers/stats-strip"
import { SuggestionsPanel } from "@/components/answers/suggestions-panel"
import { PageHeader } from "@/components/page-header"
import { getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "Answers" }

export default async function AnswersPage() {
  const queryClient = getQueryClient()
  // A failed prefetch is not an error page: the client asks again and shows its own error state.
  // Only the small queries are prefetched. The whole bank can be 2000 rows, so it loads in the browser after first paint
  // (the table shows a skeleton) instead of being rendered into the page twice, as html and as dehydrated state.
  await Promise.all([
    queryClient.prefetchQuery(serverOrpc.learning.suggestions.queryOptions()),
    queryClient.prefetchQuery(serverOrpc.learning.stats.queryOptions({ input: { limit: STATS_LIMIT } })),
  ])
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PageHeader
        title="Answers"
        description="What skiffr learned from your corrections. Check it, fix it, or make it forget."
        actions={<AddAnswerDialog />}
      />
      <div className="grid gap-4 p-4 md:p-6">
        <SuggestionsPanel />
        <StatsStrip />
        <AnswerBank />
      </div>
    </HydrationBoundary>
  )
}
