"use client"

import type { Answer } from "@skiffr/common/schemas"
import { errorMessage } from "@skiffr/orpc/errors"
import { browserClient, orpc } from "@skiffr/orpc/react"
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { toast } from "sonner"
import {
  applyDecision,
  applyRemoval,
  bankKey,
  createInflight,
  fetchAllAnswers,
  restoreRow,
  snapshotRow,
} from "@/lib/answers"
import { STATS_LIMIT } from "./stats-limit"

export type Suggestion = Awaited<ReturnType<typeof browserClient.learning.suggestions>>[number]

export function useBank() {
  return useQuery({
    queryKey: bankKey(orpc.answers.key()),
    queryFn: () => fetchAllAnswers(browserClient),
    retry: 1,
  })
}

export function useSuggestions() {
  return useQuery({ ...orpc.learning.suggestions.queryOptions(), retry: 1 })
}

export function useStats() {
  return useQuery({ ...orpc.learning.stats.queryOptions({ input: { limit: STATS_LIMIT } }), retry: 1 })
}

type RowVars = { id: string; done: string }
type DecisionVars = RowVars & { decision: "keep" | "reject" }

const ROW_KEY = ["answers", "row"] as const
/** One per page, so a card and a table row for the same answer cannot send two requests at once either. */
const inflight = createInflight()

/**
 * A request about one answer. The screen follows first, a failure puts back only that answer, and the lists are refetched
 * at the end to match the server.
 */
function useRowMutation<V extends RowVars>(opts: {
  run: (variables: V) => Promise<unknown>
  apply: (
    cache: { bank: Answer[]; suggestions: Suggestion[] },
    variables: V,
  ) => { bank: Answer[]; suggestions: Suggestion[] }
  failed: string
}) {
  const client = useQueryClient()
  const bank = bankKey(orpc.answers.key())
  const suggestions = orpc.learning.suggestions.queryKey()
  return useMutation({
    mutationKey: ROW_KEY,
    mutationFn: opts.run,
    onMutate: async (variables: V) => {
      await Promise.all([client.cancelQueries({ queryKey: bank }), client.cancelQueries({ queryKey: suggestions })])
      const cache = {
        bank: client.getQueryData<Answer[]>(bank) ?? [],
        suggestions: client.getQueryData<Suggestion[]>(suggestions) ?? [],
      }
      const before = snapshotRow(cache, variables.id)
      const next = opts.apply(cache, variables)
      client.setQueryData(bank, next.bank)
      client.setQueryData(suggestions, next.suggestions)
      return before
    },
    onError: (error, variables, before) => {
      if (before) {
        const cache = {
          bank: client.getQueryData<Answer[]>(bank) ?? [],
          suggestions: client.getQueryData<Suggestion[]>(suggestions) ?? [],
        }
        const back = restoreRow(cache, before, variables.id)
        client.setQueryData(bank, back.bank)
        client.setQueryData(suggestions, back.suggestions)
      }
      toast.error(`${opts.failed}. ${errorMessage(error)}`)
    },
    onSuccess: (_data, variables) => void toast.success(variables.done),
    onSettled: (_data, _error, variables) => {
      inflight.end(variables.id)
      return Promise.all([
        client.invalidateQueries({ queryKey: orpc.answers.key() }),
        client.invalidateQueries({ queryKey: orpc.learning.key() }),
      ])
    },
  })
}

/** Ids of the answers with a request in flight: their buttons stay disabled until it ends. */
export function usePendingRows(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { mutationKey: ROW_KEY, status: "pending" },
    select: (mutation) => (mutation.state.variables as RowVars).id,
  })
  return useMemo(() => new Set(ids), [ids])
}

/**
 * Every button names what it wants (`stop`, `restore`, `keep`, `remove`): none is worked out from the status in the cache,
 * which a click before has already changed. A second click on a row that is still waiting is dropped.
 */
export function useRowActions() {
  const decide = useRowMutation<DecisionVars>({
    run: ({ id, decision }) => browserClient.learning.resolveSuggestion({ answerId: id, decision }),
    apply: (cache, { id, decision }) => applyDecision(cache, id, decision),
    failed: "Could not update that",
  })
  const drop = useRowMutation<RowVars>({
    run: ({ id }) => browserClient.answers.remove({ id }),
    apply: (cache, { id }) => applyRemoval(cache, id),
    failed: "Could not delete it",
  })
  const pending = usePendingRows()
  const once = (id: string, send: () => void) => {
    if (inflight.start(id)) send()
  }
  return {
    pending,
    stop: (id: string) =>
      once(id, () =>
        decide.mutate({ id, decision: "reject", done: "Stopped filling this. skiffr will not offer it." }),
      ),
    restore: (id: string) =>
      once(id, () => decide.mutate({ id, decision: "keep", done: "Restored and marked confirmed" })),
    keep: (id: string) => once(id, () => decide.mutate({ id, decision: "keep", done: "Kept and marked confirmed" })),
    remove: (id: string) => once(id, () => drop.mutate({ id, done: "Answer deleted" })),
  }
}

/** Dialog saves wait for the server so a rejected value can be fixed in place. */
export function useSave(onDone: () => void) {
  const client = useQueryClient()
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: orpc.answers.key() }),
      client.invalidateQueries({ queryKey: orpc.learning.key() }),
    ])
  const update = useMutation({
    mutationFn: (input: { id: string; value: string }) => browserClient.answers.update(input),
    onSuccess: () => {
      toast.success("Answer saved and confirmed")
      onDone()
      return refresh()
    },
  })
  const create = useMutation({
    mutationFn: (input: { rawLabel: string; value: string }) => browserClient.answers.create(input),
    onSuccess: () => {
      toast.success("Answer added")
      onDone()
      return refresh()
    },
  })
  return { update, create }
}
