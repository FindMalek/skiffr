"use client"

import type { Answer } from "@skiffr/common/schemas"
import { errorMessage } from "@skiffr/orpc/errors"
import { browserClient, orpc } from "@skiffr/orpc/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { bankKey, fetchAllAnswers, statusAfter } from "@/lib/answers"
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

interface Optimistic<V> {
  run: (variables: V) => Promise<unknown>
  /** The cache as the user expects it right after the click. */
  apply: (
    variables: V,
    cache: { bank: Answer[]; suggestions: Suggestion[] },
  ) => { bank: Answer[]; suggestions: Suggestion[] }
  done: string
  failed: string
  onDone?: () => void
}

/** Updates the screen first, puts the old data back and says so when the request fails, then refetches to match the server. */
function useOptimistic<V>({ run, apply, done, failed, onDone }: Optimistic<V>) {
  const client = useQueryClient()
  const bank = bankKey(orpc.answers.key())
  const suggestions = orpc.learning.suggestions.queryKey()
  return useMutation({
    mutationFn: run,
    onMutate: async (variables: V) => {
      await Promise.all([client.cancelQueries({ queryKey: bank }), client.cancelQueries({ queryKey: suggestions })])
      const before = {
        bank: client.getQueryData<Answer[]>(bank),
        suggestions: client.getQueryData<Suggestion[]>(suggestions),
      }
      const next = apply(variables, { bank: before.bank ?? [], suggestions: before.suggestions ?? [] })
      if (before.bank) client.setQueryData(bank, next.bank)
      if (before.suggestions) client.setQueryData(suggestions, next.suggestions)
      return before
    },
    onError: (error, _variables, before) => {
      if (before?.bank) client.setQueryData(bank, before.bank)
      if (before?.suggestions) client.setQueryData(suggestions, before.suggestions)
      toast.error(`${failed}. ${errorMessage(error)}`)
    },
    onSuccess: () => {
      toast.success(done)
      onDone?.()
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: orpc.answers.key() }),
        client.invalidateQueries({ queryKey: orpc.learning.key() }),
      ]),
  })
}

/** Keep, restore and reject all go through the same route, which also clears the suggestion. */
export function useDecision(onDone?: () => void) {
  return useOptimistic<{ answerId: string; decision: "keep" | "reject"; done?: string }>({
    run: ({ answerId, decision }) => browserClient.learning.resolveSuggestion({ answerId, decision }),
    apply: ({ answerId, decision }, { bank, suggestions }) => ({
      bank: bank.map((row) => (row.id === answerId ? { ...row, status: statusAfter(decision) } : row)),
      suggestions: suggestions.filter((s) => s.answer.id !== answerId),
    }),
    done: "Saved",
    failed: "Could not save that",
    onDone,
  })
}

export function useRemove(onDone?: () => void) {
  return useOptimistic<{ id: string }>({
    run: ({ id }) => browserClient.answers.remove({ id }),
    apply: ({ id }, { bank, suggestions }) => ({
      bank: bank.filter((row) => row.id !== id),
      suggestions: suggestions.filter((s) => s.answer.id !== id),
    }),
    done: "Answer deleted",
    failed: "Could not delete it",
    onDone,
  })
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
