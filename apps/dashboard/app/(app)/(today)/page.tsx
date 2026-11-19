import { firstName } from "@skiffr/common/utils"
import type { Metadata } from "next"
import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { RetryButton } from "@/components/settings/retry-button"
import {
  ActivitySection,
  AttentionSection,
  ReviewSection,
  SetupSection,
  settle,
  UpNextSection,
  WeekSection,
} from "@/components/today/today-sections"
import {
  ActivitySkeleton,
  AttentionSkeleton,
  ErrorBox,
  ReviewSkeleton,
  SetupSkeleton,
  TodayLayout,
  UpNextSkeleton,
  WeekSkeleton,
} from "@/components/today/today-view"
import { call } from "@/lib/api"

export const metadata: Metadata = { title: "Today" }

/**
 * The name is the only thing the header needs. If that call fails the page keeps its header and sections, with a
 * retry, and each section still loads or fails on its own.
 */
export default async function TodayPage() {
  const me = await settle(() => call((api) => api.me.get()))
  return (
    <>
      <PageHeader title="Today" description={me.ok ? `Hello ${firstName(me.value.name)}.` : undefined} />
      <TodayLayout>
        {!me.ok && <ErrorBox what="your account" retry={<RetryButton />} />}
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
