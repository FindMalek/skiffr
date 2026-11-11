"use client"

import { errorMessage } from "@skiffr/orpc/errors"
import { Alert, AlertDescription, AlertTitle } from "@skiffr/ui/components/alert"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Skeleton } from "@skiffr/ui/components/skeleton"
import type { CSSProperties } from "react"
import { countByStatus, formatDay, percent, STATUS_TEXT, trendSentence } from "@/lib/answers"
import { useBank, useStats } from "./use-answers"

function Count({ label, value, meaning }: { label: string; value: number; meaning: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-heading font-semibold text-2xl tabular-nums">{value}</dd>
      <dd className="max-w-48 text-muted-foreground">{meaning}</dd>
    </div>
  )
}

export function StatsStrip() {
  const bank = useBank()
  const stats = useStats()
  const counts = countByStatus(bank.data ?? [])
  const points = stats.data?.applications ?? []
  const max = Math.max(...points.map((p) => p.correctionsPerField), 0.0001)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>How well it knows you</h2>
        </CardTitle>
        <CardDescription>Edits you made per form. The fewer, the better skiffr knows you.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 md:flex-row">
        <div className="shrink-0">
          {bank.isPending ? (
            <Skeleton className="h-16 w-56" />
          ) : bank.error ? (
            <p className="text-muted-foreground">Answer counts are unavailable.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
              <Count label="Answers" value={bank.data.length} meaning="All you have saved." />
              <Count
                label={STATUS_TEXT.confirmed}
                value={counts.confirmed}
                meaning="You checked it. skiffr keeps using it."
              />
              <Count
                label={STATUS_TEXT.learned}
                value={counts.learned}
                meaning="Picked up from your edits. Not checked yet."
              />
              <Count label={STATUS_TEXT.rejected} value={counts.rejected} meaning="skiffr never fills it." />
            </dl>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {stats.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : stats.error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load the trend</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                {errorMessage(stats.error)}
                <Button size="sm" variant="outline" onClick={() => stats.refetch()}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : points.length === 0 ? (
            <p className="text-muted-foreground">No applications with recorded fields yet.</p>
          ) : (
            <>
              <p className="font-medium text-sm">{trendSentence(points)}</p>
              <ol className="flex flex-col gap-1" aria-label="Share of filled fields you edited, oldest form first">
                {points.map((point) => (
                  <li key={point.applicationId} className="grid grid-cols-12 items-center gap-2">
                    <time
                      dateTime={point.appliedAt.toISOString()}
                      className="col-span-4 text-muted-foreground sm:col-span-3"
                    >
                      {formatDay(point.appliedAt)}
                    </time>
                    <span className="col-span-6 h-2 bg-muted sm:col-span-8" aria-hidden="true">
                      <span
                        className="block h-full w-(--bar) bg-foreground"
                        style={{ "--bar": `${(point.correctionsPerField / max) * 100}%` } as CSSProperties}
                      />
                    </span>
                    <span className="col-span-2 text-right tabular-nums sm:col-span-1">
                      {percent(point.correctionsPerField)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
