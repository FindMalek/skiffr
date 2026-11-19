import { PageHeader } from "@/components/page-header"
import {
  ActivitySkeleton,
  AttentionSkeleton,
  ReviewSkeleton,
  SetupSkeleton,
  TodayLayout,
  UpNextSkeleton,
  WeekSkeleton,
} from "@/components/today/today-view"

/** Shown only until the header's name is known; the sections then have their own fallbacks. */
export default function Loading() {
  return (
    <>
      <PageHeader title="Today" description="What to do next." />
      <TodayLayout>
        <SetupSkeleton />
        <UpNextSkeleton />
        <WeekSkeleton />
        <AttentionSkeleton />
        <ReviewSkeleton />
        <ActivitySkeleton />
      </TodayLayout>
      <p role="status" className="sr-only">
        Loading
      </p>
    </>
  )
}
