import { firstName } from "@skiffr/common/utils"
import type { Metadata } from "next"
import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import {
  ActivitySection,
  AttentionSection,
  ReviewSection,
  SetupSection,
  UpNextSection,
  WeekSection,
} from "@/components/today/today-sections"
import {
  ActivitySkeleton,
  AttentionSkeleton,
  ReviewSkeleton,
  SetupSkeleton,
  TodayLayout,
  UpNextSkeleton,
  WeekSkeleton,
} from "@/components/today/today-view"
import { call } from "@/lib/api"

export const metadata: Metadata = { title: "Today" }

/** The header needs the name, so only this one call holds the shell. Every section then streams behind its own boundary. */
export default async function TodayPage() {
  const me = await call((api) => api.me.get())
  return (
    <>
      <PageHeader title="Today" description={`Hello ${firstName(me.name)}.`} />
      <TodayLayout>
        <Suspense fallback={<SetupSkeleton />}>
          <SetupSection />
        </Suspense>
        <Suspense fallback={<UpNextSkeleton />}>
          <UpNextSection />
        </Suspense>
        <Suspense fallback={<WeekSkeleton />}>
          <WeekSection />
        </Suspense>
        <Suspense fallback={<AttentionSkeleton />}>
          <AttentionSection />
        </Suspense>
        <Suspense fallback={<ReviewSkeleton />}>
          <ReviewSection />
        </Suspense>
        <Suspense fallback={<ActivitySkeleton />}>
          <ActivitySection />
        </Suspense>
      </TodayLayout>
    </>
  )
}
