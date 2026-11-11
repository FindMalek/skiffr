"use client"

import { errorMessage } from "@skiffr/orpc/errors"
import { Alert, AlertDescription, AlertTitle } from "@skiffr/ui/components/alert"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Skeleton } from "@skiffr/ui/components/skeleton"
import type { CSSProperties } from "react"
import { countByStatus, formatDay, STATUS_TEXT, trendSentence } from "@/lib/answers"
import { useBank, useStats } from "./use-answers"

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-heading font-semibold text-2xl tabular-nums">{value}</dd>
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
        <CardDescription>Fewer corrections per field on each new application means it is learning.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[auto_1fr]">
        {bank.isPending ? (
          <Skeleton className="h-16 w-56" />
        ) : bank.error ? (
          <p className="text-muted-foreground">Answer counts are unavailable.</p>
        ) : (
          <dl className="grid grid-cols-4 content-start gap-6 md:grid-cols-2 md:gap-x-8">
            <Count label="Answers" value={bank.data.length} />
            <Count label={STATUS_TEXT.confirmed} value={counts.confirmed} />
            <Count label={STATUS_TEXT.learned} value={counts.learned} />
            <Count label={STATUS_TEXT.rejected} value={counts.rejected} />
          </dl>
        )}

        <div className="flex min-w-0 flex-col gap-2">
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
              <ol className="flex flex-col gap-1" aria-label="Corrections per field, oldest application first">
                {points.map((point) => (
                  <li key={point.applicationId} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2">
                    <time dateTime={point.appliedAt.toISOString()} className="text-muted-foreground">
                      {formatDay(point.appliedAt)}
                    </time>
                    <span className="h-2 bg-muted" aria-hidden="true">
                      <span
                        className="block h-full w-(--bar) bg-foreground"
                        style={{ "--bar": `${(point.correctionsPerField / max) * 100}%` } as CSSProperties}
                      />
                    </span>
                    <span className="text-right tabular-nums">{point.correctionsPerField.toFixed(2)}</span>
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
