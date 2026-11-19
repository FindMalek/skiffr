import type { ActivityEvent, Job, JobCounts } from "@skiffr/common/schemas"
import { Button } from "@skiffr/ui/components/button"
import { Section } from "@skiffr/ui/components/section"
import { StatusBadge } from "@skiffr/ui/components/status-badge"
import { TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { RelativeTime } from "@/components/time"
import { rate } from "@/lib/stats"
import {
  type AttentionItem,
  deltaText,
  describeActivity,
  type Loaded,
  queueLine,
  type SetupItem,
  sourceLabel,
} from "@/lib/today"

/**
 * Body height of each section's skeleton, set from the measured layout of a typical account (see
 * `SKELETON_HEIGHT` in the PR notes). The real content keeps its natural height, so a section whose data is taller or
 * shorter than this moves the sections below it.
 */
export const SKELETON_HEIGHT = {
  upNext: "h-[11.125rem] md:h-[10.375rem]",
  setup: "h-[30.3125rem] md:h-[16.3125rem]",
  week: "h-[14.75rem] sm:h-[7.875rem]",
  attention: "h-[9.4375rem] md:h-[7.1875rem]",
  answers: "h-[2.5rem]",
  activity: "h-[2.875rem]",
} as const

/** Every section is its own streamed server component, so this is the only wrapper a section needs. */
export function TodayLayout({ children }: { children: ReactNode }) {
  return <div className="flex max-w-6xl flex-col gap-8 p-4 md:p-6">{children}</div>
}

export function UpNextView({
  next,
  counts,
  retry,
}: {
  next: Loaded<Job | null>
  counts: Loaded<JobCounts>
  retry: ReactNode
}) {
  return (
    <Section title="Up next" description="The job to open now. The queue holds the rest, in order.">
      <>
        {!next.ok ? (
          <ErrorBox what="your queue" retry={retry} />
        ) : next.value ? (
          <div className="flex flex-col gap-4 border p-4 md:p-6">
            <div className="flex min-w-0 flex-col gap-1">
              {counts.ok && (
                <p className="text-muted-foreground text-xs tabular-nums">{queueLine(counts.value.status)}</p>
              )}
              <p className="break-words font-medium">{next.value.title}</p>
              <p className="text-muted-foreground text-sm">
                {next.value.company} · {sourceLabel(next.value.source)} · queued{" "}
                <RelativeTime value={next.value.queuedAt} />
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button render={<a href={next.value.url} target="_blank" rel="noreferrer" />} nativeButton={false}>
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
      </>
    </Section>
  )
}

/** Renders nothing once every check is done, so a finished account has no checklist left on the page. */
export function SetupView({ items, failed, retry }: { items: SetupItem[]; failed: string[]; retry: ReactNode }) {
  const incomplete = items.filter((item) => !item.done)
  if (incomplete.length === 0 && failed.length === 0) return null
  return (
    <Section title="Set up" description="The first steps for skiffr to fill and learn from your applications.">
      <>
        {failed.map((what) => (
          <ErrorBox key={what} what={what} retry={retry} />
        ))}
        {incomplete.length > 0 && (
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
        )}
      </>
    </Section>
  )
}

export function WeekView({
  applications,
  autofill,
  retry,
}: {
  applications: Loaded<{ thisWeek: number; previous: number }>
  autofill: Loaded<{ fields: number; accepted: number }>
  retry: ReactNode
}) {
  return (
    <Section title="This week" description="The last 7 days, against the 7 days before them where it is counted.">
      <>
        {!applications.ok || !autofill.ok ? (
          <ErrorBox what="this week" retry={retry} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 border p-4 md:p-6">
              <p className="text-muted-foreground text-xs">Applications</p>
              <p className="font-heading font-semibold text-3xl tabular-nums">{applications.value.thisWeek}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {deltaText(applications.value.thisWeek, applications.value.previous)}
              </p>
            </div>
            <div className="flex flex-col gap-1 border p-4 md:p-6">
              <p className="text-muted-foreground text-xs">Fields skiffr filled</p>
              <p className="font-heading font-semibold text-3xl tabular-nums">{autofill.value.fields}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {rate(autofill.value.accepted, autofill.value.fields) === null
                  ? "Not enough fields yet to show a rate"
                  : `${Math.round((autofill.value.accepted / autofill.value.fields) * 100)}% kept without edits`}
              </p>
            </div>
          </div>
        )}
      </>
    </Section>
  )
}

export function AttentionView({ items, retry }: { items: Loaded<AttentionItem[]>; retry: ReactNode }) {
  return (
    <Section title="Needs attention" description="Things that stop skiffr working until you act.">
      <>
        {!items.ok ? (
          <ErrorBox what="what needs attention" retry={retry} />
        ) : items.value.length === 0 ? (
          <p className="text-sm">Nothing needs attention.</p>
        ) : (
          <ul className="divide-y border">
            {items.value.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <StatusBadge tone="warning">Needs attention</StatusBadge>
                <span className="min-w-0 flex-1 text-sm">{item.text}</span>
                <Button variant="outline" size="sm" render={<Link href={item.href} />} nativeButton={false}>
                  Fix it
                </Button>
              </li>
            ))}
          </ul>
        )}
      </>
    </Section>
  )
}

export function ActivityView({ activity, retry }: { activity: Loaded<ActivityEvent[]>; retry: ReactNode }) {
  return (
    <Section title="Recent activity" description="What happened in your account in the last 30 days, newest first.">
      <>
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
      </>
    </Section>
  )
}

export function EmptyBox({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border p-4 md:p-6">
      <p className="font-medium">{title}</p>
      <p className="max-w-prose text-muted-foreground text-sm">{text}</p>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

export function ErrorBox({ what, retry }: { what: string; retry: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border p-4 md:p-6">
      <p role="alert" className="flex items-center gap-2 font-medium text-sm">
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

/** The real `Section` header and the same reserved body as the content, so only the body text is missing. */
function SectionSkeleton({
  title,
  description,
  slot,
  children,
}: {
  title: string
  description: string
  slot: string
  children: ReactNode
}) {
  return (
    <div aria-busy="true" className="min-w-0">
      <Section title={title} description={description}>
        <div className={slot}>{children}</div>
      </Section>
    </div>
  )
}

export function UpNextSkeleton() {
  return (
    <SectionSkeleton
      title="Up next"
      description="The job to open now. The queue holds the rest, in order."
      slot={SKELETON_HEIGHT.upNext}
    >
      <div className="h-full border bg-border" />
    </SectionSkeleton>
  )
}

export function SetupSkeleton() {
  return (
    <SectionSkeleton
      title="Set up"
      description="The first steps for skiffr to fill and learn from your applications."
      slot={SKELETON_HEIGHT.setup}
    >
      <div className="h-full border bg-border" />
    </SectionSkeleton>
  )
}

export function WeekSkeleton() {
  return (
    <SectionSkeleton
      title="This week"
      description="The last 7 days, against the 7 days before them where it is counted."
      slot={SKELETON_HEIGHT.week}
    >
      <div className="grid h-full grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="border bg-border" />
        <div className="border bg-border" />
      </div>
    </SectionSkeleton>
  )
}

export function AttentionSkeleton() {
  return (
    <SectionSkeleton
      title="Needs attention"
      description="Things that stop skiffr working until you act."
      slot={SKELETON_HEIGHT.attention}
    >
      <div className="h-full bg-border" />
    </SectionSkeleton>
  )
}

export function ReviewSkeleton() {
  return (
    <SectionSkeleton
      title="Answers"
      description="Answers that need a decision from you."
      slot={SKELETON_HEIGHT.answers}
    >
      <div className="h-full bg-border" />
    </SectionSkeleton>
  )
}

export function ActivitySkeleton() {
  return (
    <SectionSkeleton
      title="Recent activity"
      description="What happened in your account in the last 30 days, newest first."
      slot={SKELETON_HEIGHT.activity}
    >
      <div className="h-full border bg-border" />
    </SectionSkeleton>
  )
}
