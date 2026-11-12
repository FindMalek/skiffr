import { PageHeader } from "@/components/page-header"
import { StatsSkeleton } from "@/components/stats/stats-view"

export default function Loading() {
  return (
    <>
      <PageHeader title="Stats" description="What you applied to, what came back, and how well autofill knows you." />
      <StatsSkeleton />
    </>
  )
}
