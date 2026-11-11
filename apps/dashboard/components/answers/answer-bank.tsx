"use client"

import type { Answer } from "@skiffr/common/schemas"
import { errorMessage } from "@skiffr/orpc/errors"
import { Alert, AlertDescription, AlertTitle } from "@skiffr/ui/components/alert"
import { Badge } from "@skiffr/ui/components/badge"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { Input } from "@skiffr/ui/components/input"
import { Skeleton } from "@skiffr/ui/components/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@skiffr/ui/components/table"
import { cn } from "@skiffr/ui/lib/utils"
import {
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { type ComponentProps, useRef, useState } from "react"
import {
  filterAnswers,
  formatDay,
  paginate,
  resultsSentence,
  SORTS,
  SOURCE_TEXT,
  type SortKey,
  STATUS_FILTERS,
  STATUS_TEXT,
  type StatusFilter,
  sortAnswers,
} from "@/lib/answers"
import { DeleteAnswerDialog, EditAnswerDialog } from "./answer-dialogs"
import { plainLabel, SafeText } from "./safe-text"
import { useBank, useDecision } from "./use-answers"

const SELECT =
  "h-8 w-full border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground"

function StatusBadge({ status }: { status: Answer["status"] }) {
  return (
    <Badge
      variant={status === "confirmed" ? "default" : "outline"}
      className={cn(status === "rejected" && "border-destructive text-destructive")}
    >
      {STATUS_TEXT[status]}
    </Badge>
  )
}

function Day({ value }: { value: Date | null }) {
  if (!value) return <span className="text-muted-foreground">Never</span>
  return <time dateTime={value.toISOString()}>{formatDay(value)}</time>
}

interface Actions {
  onEdit: (answer: Answer) => void
  onDelete: (answer: Answer) => void
  onToggle: (answer: Answer) => void
}

function RowActions({ answer, actions, compact }: { answer: Answer; actions: Actions; compact: boolean }) {
  const name = plainLabel(answer.rawLabel)
  const rejected = answer.status === "rejected"
  const size = compact ? "icon-sm" : "sm"
  const show = (icon: React.ReactNode, text: string) =>
    compact ? (
      <>
        {icon}
        <span className="sr-only">{text}</span>
      </>
    ) : (
      <>
        {icon}
        {text}
      </>
    )
  const props = (text: string): ComponentProps<typeof Button> => ({
    variant: "outline",
    size,
    "aria-label": `${text}: ${name}`,
    title: compact ? text : undefined,
  })
  return (
    <div className="flex flex-wrap gap-2">
      <Button {...props("Edit")} onClick={() => actions.onEdit(answer)}>
        {show(<PencilIcon data-icon={compact ? undefined : "inline-start"} />, "Edit")}
      </Button>
      <Button {...props(rejected ? "Restore" : "Reject")} onClick={() => actions.onToggle(answer)}>
        {rejected
          ? show(<RotateCcwIcon data-icon={compact ? undefined : "inline-start"} />, "Restore")
          : show(<BanIcon data-icon={compact ? undefined : "inline-start"} />, "Reject")}
      </Button>
      <Button {...props("Delete")} onClick={() => actions.onDelete(answer)}>
        {show(<Trash2Icon data-icon={compact ? undefined : "inline-start"} />, "Delete")}
      </Button>
    </div>
  )
}

function QuestionCell({ answer }: { answer: Answer }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <SafeText text={answer.rawLabel} lines={2} className="font-medium text-sm" />
      <span className="text-muted-foreground">{SOURCE_TEXT[answer.source]}</span>
    </div>
  )
}

function AnswersTable({ rows, actions }: { rows: Answer[]; actions: Actions }) {
  return (
    <div className="hidden lg:block">
      <Table className="table-fixed">
        <caption className="sr-only">Saved answers</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-[24%]">
              Question
            </TableHead>
            <TableHead scope="col" className="w-[26%]">
              Answer
            </TableHead>
            <TableHead scope="col" className="w-24">
              Status
            </TableHead>
            <TableHead scope="col" className="w-14 text-right">
              Used
            </TableHead>
            <TableHead scope="col" className="w-20 text-right">
              Corrected
            </TableHead>
            <TableHead scope="col" className="w-28">
              Last corrected
            </TableHead>
            <TableHead scope="col" className="w-32">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((answer) => (
            <TableRow key={answer.id} className={cn(answer.status === "rejected" && "opacity-80")}>
              <TableCell className="align-top whitespace-normal">
                <QuestionCell answer={answer} />
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <SafeText text={answer.value} lines={3} max={300} />
              </TableCell>
              <TableCell className="align-top">
                <StatusBadge status={answer.status} />
              </TableCell>
              <TableCell className="text-right align-top tabular-nums">{answer.timesUsed}</TableCell>
              <TableCell className="text-right align-top tabular-nums">{answer.timesCorrected}</TableCell>
              <TableCell className="align-top whitespace-normal">
                <Day value={answer.lastCorrectedAt} />
              </TableCell>
              <TableCell className="align-top">
                <RowActions answer={answer} actions={actions} compact />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AnswerCards({ rows, actions }: { rows: Answer[]; actions: Actions }) {
  return (
    <ul className="flex flex-col gap-3 lg:hidden" aria-label="Saved answers">
      {rows.map((answer) => (
        <li key={answer.id} className="flex flex-col gap-3 border p-3">
          <div className="flex items-start justify-between gap-3">
            <QuestionCell answer={answer} />
            <StatusBadge status={answer.status} />
          </div>
          <SafeText text={answer.value} lines={3} max={300} />
          <p className="text-muted-foreground tabular-nums">
            Used {answer.timesUsed} · Corrected {answer.timesCorrected} · Last corrected{" "}
            <Day value={answer.lastCorrectedAt} />
          </p>
          <RowActions answer={answer} actions={actions} compact={false} />
        </li>
      ))}
    </ul>
  )
}

export function AnswerBank() {
  const bank = useBank()
  const decide = useDecision()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [sort, setSort] = useState<SortKey>("recent")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Answer | null>(null)
  const [deleting, setDeleting] = useState<Answer | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const all = bank.data ?? []
  const filtered = sortAnswers(filterAnswers(all, query, status), sort)
  const view = paginate(filtered, page)
  const first = (view.page - 1) * 20 + 1
  const filtering = query.trim() !== "" || status !== "all"

  const actions: Actions = {
    onEdit: setEditing,
    onDelete: setDeleting,
    onToggle: (answer) =>
      decide.mutate({ answerId: answer.id, decision: answer.status === "rejected" ? "keep" : "reject" }),
  }
  const reset = () => {
    setQuery("")
    setStatus("all")
    setPage(1)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={heading} tabIndex={-1} id="answers-heading" className="outline-none">
            Your answers
          </h2>
        </CardTitle>
        <CardDescription>
          Edit what skiffr fills, reject what it should leave empty, delete what it should forget.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <search className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative block">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search questions"
              className="pl-7"
              placeholder="Search questions"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
          </div>
          <div className="block sm:w-40">
            <select
              aria-label="Filter by status"
              className={SELECT}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter)
                setPage(1)
              }}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="block sm:w-44">
            <select
              aria-label="Sort by"
              className={SELECT}
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as SortKey)
                setPage(1)
              }}
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </search>

        <p role="status" className="sr-only">
          {bank.isSuccess ? resultsSentence(filtered.length, all.length, sort) : ""}
        </p>

        {bank.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : bank.error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load your answers</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {errorMessage(bank.error)}
              <Button size="sm" variant="outline" disabled={bank.isFetching} onClick={() => bank.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : all.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No answers yet</EmptyTitle>
              <EmptyDescription>
                skiffr saves an answer when you correct a filled field. You can also add one yourself.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No answers match</EmptyTitle>
              <EmptyDescription>Try another search or status.</EmptyDescription>
            </EmptyHeader>
            {filtering && (
              <Button variant="outline" size="sm" onClick={reset}>
                Clear filters
              </Button>
            )}
          </Empty>
        ) : (
          <>
            <AnswersTable rows={view.rows} actions={actions} />
            <AnswerCards rows={view.rows} actions={actions} />
            <nav aria-label="Answer pages" className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground tabular-nums">
                {first}-{first + view.rows.length - 1} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
                  <ChevronLeftIcon data-icon="inline-start" />
                  Previous
                </Button>
                <span className="text-muted-foreground tabular-nums">
                  Page {view.page} of {view.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={view.page >= view.pages}
                  onClick={() => setPage(view.page + 1)}
                >
                  Next
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </nav>
          </>
        )}
      </CardContent>
      <EditAnswerDialog answer={editing} onClose={() => setEditing(null)} />
      <DeleteAnswerDialog
        answer={deleting}
        onClose={(deleted) => {
          setDeleting(null)
          if (deleted) requestAnimationFrame(() => heading.current?.focus())
        }}
      />
    </Card>
  )
}
