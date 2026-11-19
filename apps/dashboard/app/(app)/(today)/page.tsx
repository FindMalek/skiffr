import { firstName } from "@skiffr/common/utils"
import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { RetryButton } from "@/components/settings/retry-button"
import { TodayView } from "@/components/today/today-view"
import { call } from "@/lib/api"
import type { Loaded, TodayData } from "@/lib/today"

export const metadata: Metadata = { title: "Today" }

/** One failed query must not blank the page: each section loads on its own and shows its own error. */
async function settle<T>(load: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await load() }
  } catch (error) {
    // `call` turns an expired session into a redirect. Rethrow it, or the section would hide the sign-in redirect.
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String(error.digest).startsWith("NEXT_REDIRECT")
    )
      throw error
    return { ok: false }
  }
}

export default async function TodayPage() {
  const me = await call((api) => api.me.get())
  const [queue, profile, extension, review, activity] = await Promise.all([
    settle(async () => {
      const [counts, next] = await Promise.all([call((api) => api.jobs.counts()), call((api) => api.jobs.next())])
      return { counts, next }
    }),
    settle(() => call((api) => api.profile.get())),
    settle(() => call((api) => api.extension.status())),
    settle(async () => (await call((api) => api.learning.suggestions())).length),
    settle(async () => (await call((api) => api.activity.list({ limit: 8 }))).items),
  ])
  const data: TodayData = { queue, profile, extension, review, activity }
  return (
    <>
      <PageHeader title="Today" description={`Hello ${firstName(me.name)}.`} />
      <TodayView data={data} retry={<RetryButton />} />
    </>
  )
}
