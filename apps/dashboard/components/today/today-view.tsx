import { Button } from "@skiffr/ui/components/button"
import { Section } from "@skiffr/ui/components/section"
import { StatusBadge } from "@skiffr/ui/components/status-badge"
import { TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { RelativeTime } from "@/components/time"
import { describeActivity, profileProgress, queueLine, reviewLine, setupItems, type TodayData } from "@/lib/today"

/** The sections always render, so the skeleton and the page take the same space. Only the copy changes. */
export function TodayView({ data, retry }: { data: TodayData; retry: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 p-4 md:p-6 max-w-6xl">
      <UpNext queue={data.queue} retry={retry} />
      <Setup data={data} retry={retry} />
      <Review review={data.review} retry={retry} />
      <Activity activity={data.activity} retry={retry} />
    </div>
  )
}

function UpNext({ queue, retry }: { queue: TodayData["queue"]; retry: ReactNode }) {
  return (
    <Section title="Up next" description="The job to open now. The queue holds the rest, in order.">
      {!queue.ok ? (
        <ErrorBox what="your queue" retry={retry} />
      ) : queue.value.next ? (
        <div className="flex flex-col gap-4 border p-4 md:p-6">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-muted-foreground text-xs tabular-nums">{queueLine(queue.value.counts.status)}</p>
            <p className="break-words font-medium">{queue.value.next.title}</p>
            <p className="text-muted-foreground text-sm">
              {queue.value.next.company} · <span className="font-mono text-xs">{queue.value.next.source}</span> · queued{" "}
              <RelativeTime value={queue.value.next.queuedAt} />
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button render={<a href={queue.value.next.url} target="_blank" rel="noreferrer" />} nativeButton={false}>
              Open job<span className="sr-only"> in a new tab</span>
            </Button>
            <Button variant="outline" render={<Link href="/queue" />} nativeButton={false}>
              Go to the queue
            </Button>
          </div>
        </div>
      ) : (
        <EmptyBox
          title="Your queue is empty"
          text="Paste a job link on the queue, or let Gmail alerts and careers pages add jobs. The next one to open shows here."
          action={
            <Button render={<Link href="/queue" />} nativeButton={false}>
              Add a job
            </Button>
          }
        />
      )}
    </Section>
  )
}

function Setup({ data, retry }: { data: TodayData; retry: ReactNode }) {
  const { profile, extension } = data
  const incomplete = setupItems({
    profile: profile.ok ? profileProgress(profile.value) : undefined,
    extension: extension.ok ? extension.value : undefined,
  }).filter((item) => !item.done)
  const failed = [profile.ok ? null : "your profile", extension.ok ? null : "the extension status"].filter(
    (what): what is string => what !== null,
  )
  return (
    <Section title="Set up" description="The profile and the extension are what skiffr fills forms with.">
      {failed.map((what) => (
        <ErrorBox key={what} what={what} retry={retry} />
      ))}
      {incomplete.length > 0 ? (
        <ul className="divide-y border">
          {incomplete.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium text-sm">{item.label}</p>
                <p className="text-muted-foreground text-xs">
                  {item.detail}
                  {item.lastSeenAt && (
                    <>
                      , last seen <RelativeTime value={item.lastSeenAt} />
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge tone={item.tone}>{item.toneWord}</StatusBadge>
                <Button variant="outline" size="sm" render={<Link href={item.href} />} nativeButton={false}>
                  {item.action}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        failed.length === 0 && <p className="text-sm">Profile and extension are set up.</p>
      )}
    </Section>
  )
}

function Review({ review, retry }: { review: TodayData["review"]; retry: ReactNode }) {
  return (
    <Section title="Answers" description="Answers that need a decision from you.">
      {!review.ok ? (
        <ErrorBox what="your answers" retry={retry} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm tabular-nums">{reviewLine(review.value)}</p>
          {review.value > 0 && (
            <Button variant="outline" size="sm" render={<Link href="/answers" />} nativeButton={false}>
              Review answers
            </Button>
          )}
        </div>
      )}
    </Section>
  )
}

function Activity({ activity, retry }: { activity: TodayData["activity"]; retry: ReactNode }) {
  return (
    <Section title="Recent activity" description="What happened in your account in the last 30 days, newest first.">
      {!activity.ok ? (
        <ErrorBox what="the activity" retry={retry} />
      ) : activity.value.length === 0 ? (
        <EmptyBox
          title="Nothing yet"
          text="Activity shows up once skiffr queues a job, fills a form or learns an answer. Connect the extension to start."
          action={
            <Button variant="outline" render={<Link href="/settings/extension" />} nativeButton={false}>
              Set up the extension
            </Button>
          }
        />
      ) : (
        <ul className="divide-y border">
          {activity.value.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <span className="min-w-0 break-words text-sm">{describeActivity(event)}</span>
              <RelativeTime value={event.at} className="text-muted-foreground text-xs" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function EmptyBox({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border p-4 md:p-6">
      <p className="font-medium">{title}</p>
      <p className="max-w-prose text-muted-foreground text-sm">{text}</p>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

function ErrorBox({ what, retry }: { what: string; retry: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border p-4 md:p-6">
      <p className="flex items-center gap-2 font-medium text-sm">
        <TriangleAlertIcon aria-hidden="true" className="size-4 text-destructive" />
        Could not load {what}.
      </p>
      <p className="max-w-prose text-muted-foreground text-sm">
        The rest of the page still works. Try again in a moment.
      </p>
      <div>{retry}</div>
    </div>
  )
}

/** Same blocks and heights as `TodayView`, for `loading.tsx`. Static blocks, no shimmer (DESIGN 2.6). */
export function TodaySkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8 p-4 md:p-6 max-w-6xl">
      <Section title="Up next" description="The job to open now. The queue holds the rest, in order.">
        <div className="h-28 border bg-border" />
      </Section>
      <Section title="Set up" description="The profile and the extension are what skiffr fills forms with.">
        <div className="flex flex-col border">
          <div className="h-14 border-b bg-border" />
          <div className="h-14 bg-border" />
        </div>
      </Section>
      <Section title="Answers" description="Answers that need a decision from you.">
        <div className="h-5 w-48 bg-border" />
      </Section>
      <Section title="Recent activity" description="What happened in your account in the last 30 days, newest first.">
        <div className="flex flex-col border">
          <div className="h-10 border-b bg-border" />
          <div className="h-10 border-b bg-border" />
          <div className="h-10 bg-border" />
        </div>
      </Section>
    </div>
  )
}
