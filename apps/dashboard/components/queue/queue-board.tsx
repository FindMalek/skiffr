"use client"

import type { Job } from "@skiffr/common/schemas"
import { displayText, safeHref } from "@skiffr/common/utils"
import { errorMessage } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
import { Alert, AlertDescription, AlertTitle } from "@skiffr/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@skiffr/ui/components/alert-dialog"
import { Button } from "@skiffr/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { Input } from "@skiffr/ui/components/input"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLinkIcon, PlusIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import {
  DEFAULT_FILTERS,
  listInput,
  QUEUE_PAGE,
  QUEUE_SHOWN_MAX,
  type QueueFilters,
  STATUS_LABEL,
  type StatusFilter,
  sourceLabel,
} from "@/lib/queue"
import { AddJobForm } from "./add-job-form"
import { JobList, type OnAction } from "./job-rows"
import { SafeText } from "./job-text"
import { useQueueApi } from "./queue-api"
import { useQueueActions } from "./use-queue-actions"

const STATUS_TABS: StatusFilter[] = ["queued", "applied", "skipped", "all"]

type Confirm = { kind: "applied"; job: Job } | { kind: "remove"; ids: readonly string[]; job?: Job } | null

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** The queue changes from other tabs and from the extension, so what is on screen is refreshed when the tab is focused again. */
const LIVE = { staleTime: 5_000, refetchOnWindowFocus: true } as const

/**
 * Opens the server's current next job in a new tab. The button shows the cached next job, but a click first asks the
 * server again and opens what it answers, so a job applied or deleted elsewhere is never opened by a stale page.
 */
function OpenNext({ disabled }: { disabled: boolean }) {
  const api = useQueueApi()
  const queryClient = useQueryClient()
  const next = useQuery({ ...orpc.jobs.next.queryOptions(), ...LIVE })
  const opening = useRef(false)
  const shown = next.data

  const open = async () => {
    if (opening.current) return
    opening.current = true
    try {
      const fresh = await queryClient.fetchQuery({
        queryKey: orpc.jobs.next.queryKey(),
        queryFn: () => api.next(),
        staleTime: 0,
      })
      if ((fresh?.id ?? null) !== (shown?.id ?? null)) {
        // The queue moved on elsewhere: refresh what the page shows (the next job itself was just fetched).
        void queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key() })
        void queryClient.invalidateQueries({ queryKey: orpc.jobs.counts.key() })
      }
      if (!fresh) return void toast.info("Nothing is queued.")
      const href = safeHref(fresh.url)
      if (!href) return void toast.error("That job's link is not a web address, so it was not opened.")
      window.open(href, "_blank", "noopener,noreferrer")
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      opening.current = false
    }
  }

  return (
    <Button disabled={disabled || !shown} onClick={open} className="max-w-full">
      <ExternalLinkIcon data-icon="inline-start" />
      <span className="truncate">
        {shown ? `Open next: ${displayText(shown.company, 24)}, ${displayText(shown.title, 32)}` : "Open next"}
      </span>
    </Button>
  )
}

export function QueueBoard() {
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS)
  const [search, setSearch] = useState("")
  const [shown, setShown] = useState(QUEUE_PAGE)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [message, setMessage] = useState({ text: "", n: 0 })
  const announce = useCallback((text: string) => setMessage((m) => ({ text, n: m.n + 1 })), [])
  const results = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<Element | null>(null)
  const parkFocus = useRef(false)

  const q = useDebounced(search, 250)
  const active = useMemo(() => ({ ...filters, q }), [filters, q])
  const input = listInput(active, shown)
  const list = useQuery({ ...orpc.jobs.list.queryOptions({ input }), ...LIVE, placeholderData: keepPreviousData })
  const counts = useQuery({ ...orpc.jobs.counts.queryOptions(), ...LIVE })
  const actions = useQueueActions(announce)

  const rows = useMemo(() => (list.data ?? []).slice(0, shown), [list.data, shown])
  const hasMore = (list.data?.length ?? 0) > shown
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected])
  const anySelectedBusy = selectedRows.some((row) => actions.busy.has(row.id))
  const statusCounts = counts.data?.status
  const total = statusCounts ? statusCounts.queued + statusCounts.applied + statusCounts.skipped : undefined

  const refilter = useCallback((change: Partial<QueueFilters>) => {
    setFilters((f) => ({ ...f, ...change }))
    setShown(QUEUE_PAGE)
    setSelected(new Set())
  }, [])

  const select = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const dropSelection = useCallback((ids: readonly string[]) => {
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
  }, [])

  const askConfirm = useCallback((next: Exclude<Confirm, null>) => {
    trigger.current = document.activeElement
    setConfirm(next)
  }, [])

  const onAction: OnAction = useCallback(
    (action, job) => {
      parkFocus.current = true
      if (action === "skip") void actions.skip([job.id])
      else if (action === "restore") void actions.restore([job.id])
      else if (action === "applied") askConfirm({ kind: "applied", job })
      else askConfirm({ kind: "remove", ids: [job.id], job })
    },
    [askConfirm, actions.skip, actions.restore],
  )

  // A removed row takes focus with it: park it on the results heading so keyboard users keep their place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the rows change.
  useEffect(() => {
    const focused = document.activeElement
    if (parkFocus.current && (!focused || focused === document.body || !focused.isConnected)) {
      results.current?.focus()
      parkFocus.current = false
    }
  }, [rows])

  const finalFocus = () => {
    const el = trigger.current
    return el instanceof HTMLElement && el.isConnected ? el : (results.current ?? true)
  }

  const confirmed = confirm
  const run = () => {
    if (!confirmed) return
    setConfirm(null)
    parkFocus.current = true
    if (confirmed.kind === "applied") void actions.markApplied(confirmed.job)
    else {
      const { ids } = confirmed
      void actions.remove(ids).then((ok) => ok && dropSelection(ids))
    }
  }

  const filtering = filters.status !== DEFAULT_FILTERS.status || filters.source !== "" || q !== ""
  const emptyAll = total === 0 && !filtering && !list.isFetching
  const sources = counts.data?.sources ?? []
  const sourceOptions =
    filters.source && !sources.some((s) => s.source === filters.source)
      ? [...sources, { source: filters.source, count: 0 }]
      : sources
  const caption = `${filters.status === "all" ? "All" : STATUS_LABEL[filters.status]} jobs, ${rows.length} shown`
  const totalForView =
    filters.source || q ? undefined : filters.status === "all" ? total : statusCounts?.[filters.status]

  return (
    <>
      <PageHeader
        title="Queue"
        description="Jobs you want to apply to. Work through them in order, you always press submit yourself."
        actions={<OpenNext disabled={actions.busy.size > 0} />}
      />
      <div className="grid grid-cols-1 gap-4 p-4 md:p-6">
        <p role="status" aria-live="polite" className="sr-only">
          {message.text}
          {message.n % 2 ? " " : ""}
        </p>
        <Button
          variant="outline"
          className="md:hidden"
          aria-expanded={addOpen}
          aria-controls="add-job"
          onClick={() => setAddOpen((open) => !open)}
        >
          <PlusIcon data-icon="inline-start" />
          {addOpen ? "Hide the add form" : "Add a job"}
        </Button>
        <div id="add-job" className={addOpen ? undefined : "max-md:hidden"}>
          <AddJobForm announce={announce} />
        </div>

        <section aria-labelledby="queue-results" className="grid min-w-0 grid-cols-1 gap-3">
          <h2 id="queue-results" ref={results} tabIndex={-1} className="sr-only outline-none">
            Jobs
          </h2>
          <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
            <legend className="sr-only">Filter by status</legend>
            {STATUS_TABS.map((status) => {
              const count = status === "all" ? total : statusCounts?.[status]
              const current = filters.status === status
              return (
                <Button
                  key={status}
                  variant={current ? "secondary" : "outline"}
                  aria-pressed={current}
                  onClick={() => refilter({ status })}
                >
                  {status === "all" ? "All" : STATUS_LABEL[status]}
                  <span className="font-mono tabular-nums">{count ?? "–"}</span>
                </Button>
              )
            })}
          </fieldset>

          <div className="flex min-h-9 flex-wrap items-center gap-2">
            {selectedRows.length > 0 ? (
              <section aria-label="Bulk actions" className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{selectedRows.length} selected</span>
                <Button
                  variant="outline"
                  disabled={anySelectedBusy}
                  onClick={() => {
                    parkFocus.current = true
                    const ids = selectedRows.map((row) => row.id)
                    void actions.skip(ids).then((ok) => ok && dropSelection(ids))
                  }}
                >
                  Skip selected
                </Button>
                <Button
                  variant="destructive"
                  disabled={anySelectedBusy}
                  onClick={() => askConfirm({ kind: "remove", ids: selectedRows.map((row) => row.id) })}
                >
                  Remove selected
                </Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              </section>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={false}
                    disabled={rows.length === 0}
                    onChange={() => setSelected(new Set(rows.map((row) => row.id)))}
                  />
                  Select all
                </label>
                <Input
                  type="search"
                  aria-label="Search by company or role"
                  placeholder="Search company or role"
                  className="w-full sm:w-64"
                  maxLength={100}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setShown(QUEUE_PAGE)
                  }}
                />
                <select
                  aria-label="Filter by source"
                  value={filters.source}
                  onChange={(event) => refilter({ source: event.target.value })}
                  className="h-8 max-w-full border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  <option value="">All sources</option>
                  {sourceOptions.map((entry) => (
                    <option key={entry.source} value={entry.source}>
                      {displayText(sourceLabel(entry.source), 40)} ({entry.count})
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {list.isError && !list.data ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Could not load the queue</AlertTitle>
              <AlertDescription>
                <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : !list.data ? (
            <QueueSkeleton />
          ) : emptyAll ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>Your queue is empty</EmptyTitle>
                <EmptyDescription>
                  Jobs land here from a few places. Add one by its link above. Gmail job alerts and the browser
                  extension will add them for you soon, and so will careers pages you watch.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : rows.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>{filtering ? "No jobs match" : "Nothing here yet"}</EmptyTitle>
                <EmptyDescription>
                  {filtering
                    ? "Try another status, source or search."
                    : `No ${filters.status === "all" ? "" : `${filters.status} `}jobs.`}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div aria-busy={list.isPlaceholderData} className={list.isPlaceholderData ? "opacity-70" : undefined}>
              <JobList
                rows={rows}
                selected={selected}
                busy={actions.busy}
                onSelect={select}
                onAction={onAction}
                caption={caption}
              />
            </div>
          )}

          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
            <p role="status" aria-live="polite">
              {list.data
                ? `Showing ${rows.length}${totalForView !== undefined ? ` of ${totalForView}` : ""} jobs.`
                : ""}
            </p>
            {hasMore &&
              (shown < QUEUE_SHOWN_MAX ? (
                <Button variant="outline" onClick={() => setShown((n) => n + QUEUE_PAGE)}>
                  Show more
                </Button>
              ) : (
                <span>Search or filter to narrow it down.</span>
              ))}
          </div>
        </section>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent finalFocus={finalFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "applied"
                ? "Mark as applied?"
                : confirm && confirm.ids.length > 1
                  ? `Remove ${confirm.ids.length} jobs?`
                  : "Remove this job?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "applied" ? (
                <>
                  This adds <SafeText value={confirm.job.title} max={80} /> at{" "}
                  <SafeText value={confirm.job.company} max={40} /> to your applications and cannot be undone from this
                  page. Removing the job deletes the application too.
                </>
              ) : confirm?.job ? (
                <>
                  <SafeText value={confirm.job.title} max={80} /> at <SafeText value={confirm.job.company} max={40} />{" "}
                  and its application, if any, are deleted for good.
                </>
              ) : (
                "The jobs and their applications, if any, are deleted for good."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={confirm?.kind === "applied" ? "default" : "destructive"} onClick={run}>
              {confirm?.kind === "applied" ? "Mark applied" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Same row height and columns as the list, so loading and loaded look alike. */
export function QueueSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-12 animate-pulse bg-muted motion-reduce:animate-none" />
      ))}
    </div>
  )
}
