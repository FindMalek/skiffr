"use client"

import type { Job, JobCounts } from "@skiffr/common/schemas"
import { errorCode, errorMessage } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import {
  applyToCounts,
  applyToList,
  type Intent,
  type JobListInput,
  pruneList,
  revertCounts,
  revertList,
} from "@/lib/queue"
import { useQueueApi } from "./queue-api"

type ListKey = ReturnType<typeof orpc.jobs.list.queryKey>

const listEntries = (queryClient: QueryClient) =>
  queryClient.getQueriesData<Job[]>({ queryKey: orpc.jobs.list.key() }) as Array<[ListKey, Job[] | undefined]>

const inputOf = (key: ListKey): JobListInput =>
  ((key[1] as { input?: JobListInput } | undefined)?.input ?? {}) as JobListInput

/** The rows an intent touches as the page last showed them, from whichever cached list has them. */
function snapshot(queryClient: QueryClient, ids: readonly string[]): Job[] {
  const wanted = new Set(ids)
  const found = new Map<string, Job>()
  for (const [, rows] of listEntries(queryClient)) {
    for (const row of rows ?? []) if (wanted.has(row.id) && !found.has(row.id)) found.set(row.id, row)
  }
  return [...found.values()]
}

function prune(queryClient: QueryClient, ids: readonly string[]) {
  for (const [key, rows] of listEntries(queryClient))
    if (rows) queryClient.setQueryData(key, pruneList(rows, inputOf(key), ids))
}

function patch(queryClient: QueryClient, intent: Intent, before: readonly Job[], undo: boolean) {
  for (const [key, rows] of listEntries(queryClient)) {
    if (!rows) continue
    queryClient.setQueryData(
      key,
      undo ? revertList(rows, inputOf(key), before) : applyToList(rows, inputOf(key), intent),
    )
  }
  queryClient.setQueryData<JobCounts>(orpc.jobs.counts.queryKey(), (counts) =>
    counts ? (undo ? revertCounts(counts, before, intent) : applyToCounts(counts, before, intent)) : counts,
  )
}

const plural = (n: number) => (n === 1 ? "1 job" : `${n} jobs`)
const code = (error: unknown, wanted: string) => errorCode(error) === wanted

type Messages = { done: string; failed: string }

/**
 * Row actions with an explicit intent each. A row (or bulk set) that is already being sent ignores a second click
 * (the ref flips before anything async, so even two clicks in one tick send one request), the cache shows the result
 * at once, and a failure puts back only the rows that action touched and says so in a toast.
 */
export function useQueueActions(announce: (message: string) => void) {
  const api = useQueueApi()
  const queryClient = useQueryClient()
  const inFlight = useRef(new Set<string>())
  const running = useRef(0)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const settle = useCallback(
    (failed: boolean) => {
      running.current -= 1
      if (running.current > 0) return
      const refetchType = failed ? "active" : "none"
      void queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key(), refetchType })
      void queryClient.invalidateQueries({ queryKey: orpc.jobs.counts.key(), refetchType })
      void queryClient.invalidateQueries({ queryKey: orpc.jobs.next.key(), refetchType: "active" })
    },
    [queryClient],
  )

  const run = useCallback(
    async (intent: Intent, send: () => Promise<unknown>, messages: Messages, absorb?: (error: unknown) => boolean) => {
      const ids = intent.ids
      if (ids.length === 0 || ids.some((id) => inFlight.current.has(id))) return false
      for (const id of ids) inFlight.current.add(id)
      running.current += 1
      setBusy(new Set(inFlight.current))
      let failed = false
      const before = snapshot(queryClient, ids)
      try {
        await queryClient.cancelQueries({ queryKey: orpc.jobs.key() })
        patch(queryClient, intent, before, false)
        await send()
        prune(queryClient, ids)
        announce(messages.done)
      } catch (error) {
        if (absorb?.(error)) {
          prune(queryClient, ids)
          announce(messages.done)
        } else {
          failed = true
          patch(queryClient, intent, before, true)
          toast.error(`${messages.failed} ${errorMessage(error)}`)
          announce(messages.failed)
        }
      } finally {
        for (const id of ids) inFlight.current.delete(id)
        setBusy(new Set(inFlight.current))
        settle(failed)
      }
      return !failed
    },
    [announce, queryClient, settle],
  )

  const skip = useCallback(
    (ids: readonly string[]) =>
      run({ kind: "status", ids, status: "skipped" }, () => api.setStatus(ids, "skipped"), {
        done: `Skipped ${plural(ids.length)}.`,
        failed: "Could not skip.",
      }),
    [api, run],
  )
  const restore = useCallback(
    (ids: readonly string[]) =>
      run({ kind: "status", ids, status: "queued" }, () => api.setStatus(ids, "queued"), {
        done: `Restored ${plural(ids.length)} to the queue.`,
        failed: "Could not restore.",
      }),
    [api, run],
  )
  const markApplied = useCallback(
    (job: Job) =>
      run(
        { kind: "applied", ids: [job.id] },
        () => api.markApplied(job),
        { done: "Marked as applied.", failed: "Could not mark it applied." },
        (error) => code(error, "CONFLICT"),
      ),
    [api, run],
  )
  const remove = useCallback(
    (ids: readonly string[]) =>
      run(
        { kind: "remove", ids },
        () => api.remove(ids),
        { done: `Removed ${plural(ids.length)}.`, failed: "Could not remove." },
        (error) => code(error, "NOT_FOUND"),
      ),
    [api, run],
  )

  return { busy, skip, restore, markApplied, remove }
}
