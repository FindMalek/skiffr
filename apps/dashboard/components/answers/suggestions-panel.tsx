"use client"

import { errorMessage } from "@skiffr/orpc/errors"
import { Alert, AlertDescription, AlertTitle } from "@skiffr/ui/components/alert"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { Skeleton } from "@skiffr/ui/components/skeleton"
import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import { DISMISSED_MAX, dismissalKey, parseDismissed, suggestionCopy } from "@/lib/answers"
import { SafeText } from "./safe-text"
import { type Suggestion, useRowActions, useSuggestions } from "./use-answers"

const STORAGE_KEY = "skiffr:answers:dismissed"
const VISIBLE = 4
const listeners = new Set<() => void>()

function readDismissed(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

/** Dismissing a "make this your default?" card has no server side: it hides the card in this browser while the answer keeps its value. */
function useDismissed() {
  const raw = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    readDismissed,
    () => "[]",
  )
  const dismiss = useCallback((key: string) => {
    try {
      const next = [...parseDismissed(readDismissed()), key].slice(-DISMISSED_MAX)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // storage blocked: the card comes back on the next visit
    }
    for (const listener of listeners) listener()
  }, [])
  const dismissed = useMemo(() => new Set(parseDismissed(raw)), [raw])
  return { dismissed, dismiss }
}

function SuggestionCard({
  suggestion,
  busy,
  onDecide,
  onDismiss,
}: {
  suggestion: Suggestion
  busy: boolean
  onDecide: (id: string, decision: "keep" | "reject") => void
  onDismiss: (key: string) => void
}) {
  const copy = suggestionCopy(suggestion.kind, suggestion.count)
  const choose = (decision: "keep" | "reject" | null) => {
    if (decision === null) return onDismiss(dismissalKey(suggestion))
    onDecide(suggestion.answer.id, decision)
  }
  return (
    <li className="flex flex-col gap-3 border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium text-sm">{copy.title}</p>
        <SafeText text={suggestion.answer.rawLabel} lines={2} className="font-medium" />
        <p className="flex min-w-0 gap-1 text-muted-foreground">
          <span className="shrink-0">Answer:</span>
          <SafeText text={suggestion.answer.value} lines={2} max={160} />
        </p>
        <p className="text-muted-foreground">{copy.question}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => choose(copy.primary.decision)}>
          {copy.primary.label}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => choose(copy.secondary.decision)}>
          {copy.secondary.label}
        </Button>
      </div>
    </li>
  )
}

export function SuggestionsPanel() {
  const { data, error, isPending, refetch, isFetching } = useSuggestions()
  const { dismissed, dismiss } = useDismissed()
  const rows = useRowActions()
  const [all, setAll] = useState(false)

  const open = (data ?? []).filter((s) => !(s.kind === "keep" && dismissed.has(dismissalKey(s))))
  const shown = all ? open : open.slice(0, VISIBLE)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Needs your call</h2>
        </CardTitle>
        <CardDescription>What skiffr noticed in your corrections. Nothing changes until you choose.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load suggestions</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {errorMessage(error)}
              <Button size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : open.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nothing to review</EmptyTitle>
              <EmptyDescription>When you keep correcting the same answer, skiffr asks here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-3" aria-label="Suggestions">
              {shown.map((suggestion) => (
                <SuggestionCard
                  key={`${suggestion.kind}:${suggestion.answer.id}`}
                  suggestion={suggestion}
                  busy={rows.pending.has(suggestion.answer.id)}
                  onDecide={(id, decision) => (decision === "keep" ? rows.keep(id) : rows.stop(id))}
                  onDismiss={dismiss}
                />
              ))}
            </ul>
            {open.length > VISIBLE && (
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `Show ${open.length - VISIBLE} more`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
