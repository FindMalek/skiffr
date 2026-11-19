import { Section } from "@skiffr/ui/components/section"
import { cache } from "react"
import { RetryButton } from "@/components/settings/retry-button"
import { call } from "@/lib/api"
import { type AttentionItem, attentionItems, type Loaded, profileProgress, setupItems, weekCompare } from "@/lib/today"
import { ReviewLine } from "./review-line"
import { ActivityView, AttentionView, ErrorBox, SetupView, UpNextView, WeekView } from "./today-view"

/**
 * Each section is its own server component with its own queries, streamed behind its own Suspense boundary. One slow
 * or failed query holds back only its section.
 */

/**
 * Pages the answer bank until one answer the user confirmed or rejected turns up, or the bank ends. Only the yes or no
 * matters here, so it stops at the first hit and never counts past the first page that has one.
 */
async function hasReviewedAnswer(): Promise<number> {
  const PAGE = 100
  const MAX_PAGES = 20
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await call((api) => api.answers.list({ limit: PAGE, offset: page * PAGE }))
    if (rows.some((a) => a.status !== "learned")) return 1
    if (rows.length < PAGE) break
  }
  return 0
}

/** Set up and Up next both need the job counts: one request per page load, shared through React's per-request cache. */
const jobCounts = cache(() => call((api) => api.jobs.counts()))

export async function settle<T>(load: () => Promise<T>): Promise<Loaded<T>> {
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

function mapLoaded<T, U>(loaded: Loaded<T>, map: (value: T) => U): Loaded<U> {
  return loaded.ok ? { ok: true, value: map(loaded.value) } : { ok: false }
}

export async function SetupSection() {
  const [profile, extension, jobs, applications, answers] = await Promise.all([
    settle(() => call((api) => api.profile.get())),
    settle(() => call((api) => api.extension.status())),
    settle(async () => {
      const { status } = await jobCounts()
      return status.queued + status.applied + status.skipped
    }),
    settle(async () => (await call((api) => api.applications.list({ limit: 1 }))).length),
    settle(() => hasReviewedAnswer()),
  ])
  const failed = [
    profile.ok ? null : "your profile",
    extension.ok ? null : "the extension status",
    jobs.ok ? null : "your jobs",
    applications.ok ? null : "your applications",
    answers.ok ? null : "your answers",
  ].filter((what): what is string => what !== null)
  const items = setupItems({
    profile: profile.ok ? profileProgress(profile.value) : undefined,
    extension: extension.ok ? extension.value : undefined,
    jobs: jobs.ok ? jobs.value : undefined,
    applications: applications.ok ? applications.value : undefined,
    reviewedAnswers: answers.ok ? answers.value : undefined,
  })
  return <SetupView items={items} failed={failed} retry={<RetryButton />} />
}

export async function UpNextSection() {
  const [next, counts] = await Promise.all([settle(() => call((api) => api.jobs.next())), settle(() => jobCounts())])
  return <UpNextView next={next} counts={counts} retry={<RetryButton />} />
}

export async function WeekSection() {
  const [month, week] = await Promise.all([
    settle(() => call((api) => api.stats.overview({ days: 30 }))),
    settle(() => call((api) => api.stats.overview({ days: 7 }))),
  ])
  return (
    <WeekView
      applications={mapLoaded(month, (stats) => weekCompare(stats.perDay))}
      autofill={mapLoaded(week, (stats) => ({ fields: stats.autofill.fields, accepted: stats.autofill.accepted }))}
      retry={<RetryButton />}
    />
  )
}

export async function AttentionSection() {
  const [gmail, sources, tokens] = await Promise.all([
    settle(() => call((api) => api.gmail.status())),
    settle(() => call((api) => api.jobSources.list())),
    settle(() => call((api) => api.tokens.list())),
  ])
  const items: Loaded<AttentionItem[]> =
    gmail.ok && sources.ok && tokens.ok
      ? {
          ok: true,
          value: attentionItems({ now: new Date(), gmail: gmail.value, sources: sources.value, tokens: tokens.value }),
        }
      : { ok: false }
  return <AttentionView items={items} retry={<RetryButton />} />
}

export async function ReviewSection() {
  const suggestions = await settle(() => call((api) => api.learning.suggestions()))
  return (
    <Section title="Answers" description="Answers that need a decision from you.">
      {suggestions.ok ? (
        <ReviewLine suggestions={suggestions.value} />
      ) : (
        <ErrorBox what="your answers" retry={<RetryButton />} />
      )}
    </Section>
  )
}

export async function ActivitySection() {
  const activity = await settle(async () => (await call((api) => api.activity.list({ limit: 8 }))).items)
  return <ActivityView activity={activity} retry={<RetryButton />} />
}
