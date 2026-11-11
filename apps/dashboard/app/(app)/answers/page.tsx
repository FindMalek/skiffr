import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { AnswerBank } from "@/components/answers/answer-bank"
import { AddAnswerDialog } from "@/components/answers/answer-dialogs"
import { STATS_LIMIT } from "@/components/answers/stats-limit"
import { StatsStrip } from "@/components/answers/stats-strip"
import { SuggestionsPanel } from "@/components/answers/suggestions-panel"
import { PageHeader } from "@/components/page-header"
import { bankKey, fetchAllAnswers } from "@/lib/answers"
import { call, getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "Answers" }

export default async function AnswersPage() {
  const queryClient = getQueryClient()
  // A failed prefetch is not an error page: the client asks again and shows its own error state.
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: bankKey(serverOrpc.answers.key()),
      queryFn: () => call((api) => fetchAllAnswers(api)),
    }),
    queryClient.prefetchQuery(serverOrpc.learning.suggestions.queryOptions()),
    queryClient.prefetchQuery(serverOrpc.learning.stats.queryOptions({ input: { limit: STATS_LIMIT } })),
  ])
  return (
    <>
      <PageHeader
        title="Answers"
        description="What skiffr learned from your corrections. Check it, fix it, or make it forget."
        actions={<AddAnswerDialog />}
      />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <div className="grid gap-4 p-4 md:p-6">
          <StatsStrip />
          <SuggestionsPanel />
          <AnswerBank />
        </div>
      </HydrationBoundary>
    </>
  )
}
