"use client"

import type { Job } from "@skiffr/common/schemas"
import { Badge } from "@skiffr/ui/components/badge"
import { Button, buttonVariants } from "@skiffr/ui/components/button"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@skiffr/ui/components/table"
import { BanIcon, CheckCheckIcon, CheckIcon, ClockIcon, RotateCcwIcon, SkipForwardIcon, Trash2Icon } from "lucide-react"
import { memo } from "react"
import { type JobStatus, jobName, STATUS_LABEL, sourceLabel } from "@/lib/queue"
import { JobHost, JobLink, SafeText } from "./job-text"

export type RowAction = "skip" | "restore" | "applied" | "remove"
export type OnAction = (action: RowAction, job: Job) => void

const STATUS_ICON: Record<JobStatus, typeof ClockIcon> = {
  queued: ClockIcon,
  applied: CheckCheckIcon,
  skipped: BanIcon,
}

/** Status is the word and an icon, never color alone. The common state (queued) is quiet text; applied and skipped are the badges. */
export function StatusBadge({ status }: { status: JobStatus }) {
  const Icon = STATUS_ICON[status]
  if (status === "queued") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground">
        <Icon aria-hidden="true" className="size-3" />
        {STATUS_LABEL[status]}
      </span>
    )
  }
  return (
    <Badge variant={status === "applied" ? "secondary" : "outline"}>
      <Icon aria-hidden="true" />
      {STATUS_LABEL[status]}
    </Badge>
  )
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="outline" className="max-w-32">
      <SafeText value={sourceLabel(source)} max={24} className="truncate" />
    </Badge>
  )
}

function QueuedAt({ value }: { value: Date }) {
  return (
    <time dateTime={value.toISOString()} suppressHydrationWarning className="whitespace-nowrap">
      {value.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
    </time>
  )
}

const ICON_BUTTON = { variant: "ghost", size: "icon-sm" } as const

function RowActions({ job, busy, onAction }: { job: Job; busy: boolean; onAction: OnAction }) {
  const name = jobName(job)
  return (
    <div className="flex items-center justify-end gap-1">
      <JobLink
        url={job.url}
        label={`Open ${name}`}
        disabled={busy}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      />
      {job.status !== "applied" && (
        <Button
          {...ICON_BUTTON}
          disabled={busy}
          focusableWhenDisabled
          aria-label={`Mark applied: ${name}`}
          title="Mark applied"
          onClick={() => onAction("applied", job)}
        >
          <CheckIcon />
        </Button>
      )}
      {job.status === "queued" && (
        <Button
          {...ICON_BUTTON}
          disabled={busy}
          focusableWhenDisabled
          aria-label={`Skip: ${name}`}
          title="Skip"
          onClick={() => onAction("skip", job)}
        >
          <SkipForwardIcon />
        </Button>
      )}
      {job.status === "skipped" && (
        <Button
          {...ICON_BUTTON}
          disabled={busy}
          focusableWhenDisabled
          aria-label={`Restore to the queue: ${name}`}
          title="Restore to the queue"
          onClick={() => onAction("restore", job)}
        >
          <RotateCcwIcon />
        </Button>
      )}
      <Button
        {...ICON_BUTTON}
        disabled={busy}
        focusableWhenDisabled
        aria-label={`Remove: ${name}`}
        title="Remove"
        onClick={() => onAction("remove", job)}
      >
        <Trash2Icon />
      </Button>
    </div>
  )
}

type RowProps = {
  job: Job
  selected: boolean
  busy: boolean
  onSelect: (id: string, selected: boolean) => void
  onAction: OnAction
}

function Check({ job, selected, busy, onSelect }: Omit<RowProps, "onAction">) {
  return (
    <input
      type="checkbox"
      className="size-4 accent-primary"
      checked={selected}
      disabled={busy}
      aria-label={`Select ${jobName(job)}`}
      onChange={(event) => onSelect(job.id, event.target.checked)}
    />
  )
}

/**
 * One row per job: a table from `xl` up, and below it a two line card (title, site and status, with the actions on the
 * first line from `md` up; company, source and time on the second). Native table elements keep an explicit ARIA role
 * so the table semantics survive the card layout.
 */
const JobRow = memo(function JobRow(props: RowProps) {
  const { job, selected, busy } = props
  return (
    <TableRow
      role="row"
      data-state={selected ? "selected" : undefined}
      aria-busy={busy}
      className={`max-xl:flex max-xl:flex-wrap max-xl:items-center max-xl:gap-x-3 max-xl:gap-y-1 max-xl:border max-xl:px-3 max-xl:py-2 ${busy ? "opacity-60" : ""}`}
    >
      <TableCell role="cell" className="w-8 max-xl:order-1 max-xl:p-0">
        <Check {...props} />
      </TableCell>
      <TableHead
        role="rowheader"
        scope="row"
        className="h-auto max-w-36 truncate p-2 font-medium max-xl:order-6 max-xl:max-w-48 max-xl:p-0 max-xl:font-normal max-xl:text-muted-foreground"
      >
        <SafeText value={job.company} max={40} />
      </TableHead>
      <TableCell
        role="cell"
        className="max-w-72 max-xl:order-2 max-xl:min-w-0 max-xl:flex-1 max-xl:p-0 max-xl:font-medium"
      >
        <SafeText value={job.title} max={90} className="block truncate max-xl:whitespace-normal max-xl:break-words" />
        <JobHost url={job.url} className="block truncate font-medium font-mono text-foreground" />
      </TableCell>
      <TableCell role="cell" className="max-xl:order-7 max-xl:p-0">
        <SourceBadge source={job.source} />
      </TableCell>
      <TableCell role="cell" className="text-muted-foreground max-xl:order-8 max-xl:p-0">
        <QueuedAt value={job.queuedAt} />
      </TableCell>
      <TableCell role="cell" className="max-xl:order-3 max-xl:p-0">
        <StatusBadge status={job.status} />
      </TableCell>
      <TableCell
        role="cell"
        className="max-md:order-9 max-md:basis-full max-xl:p-0 md:max-xl:order-4 md:max-xl:ml-auto"
      >
        <RowActions job={job} busy={busy} onAction={props.onAction} />
      </TableCell>
      <TableCell
        role="presentation"
        aria-hidden="true"
        className="hidden max-xl:order-5 max-xl:block max-xl:h-0 max-xl:basis-full max-xl:p-0"
      />
    </TableRow>
  )
})

type ListProps = {
  rows: readonly Job[]
  selected: ReadonlySet<string>
  busy: ReadonlySet<string>
  onSelect: (id: string, selected: boolean) => void
  onAction: OnAction
  caption: string
}

export function JobList({ rows, selected, busy, onSelect, onAction, caption }: ListProps) {
  return (
    <div className="min-w-0 xl:border" data-view="jobs">
      <Table role="table" className="max-xl:block">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader role="rowgroup" className="max-xl:sr-only">
          <TableRow role="row">
            <TableHead role="columnheader" scope="col" className="w-8">
              <span className="sr-only">Select</span>
            </TableHead>
            <TableHead role="columnheader" scope="col">
              Company
            </TableHead>
            <TableHead role="columnheader" scope="col">
              Role and site
            </TableHead>
            <TableHead role="columnheader" scope="col">
              Source
            </TableHead>
            <TableHead role="columnheader" scope="col">
              Queued
            </TableHead>
            <TableHead role="columnheader" scope="col">
              Status
            </TableHead>
            <TableHead role="columnheader" scope="col" className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody role="rowgroup" className="max-xl:grid max-xl:gap-2">
          {rows.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              selected={selected.has(job.id)}
              busy={busy.has(job.id)}
              onSelect={onSelect}
              onAction={onAction}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
