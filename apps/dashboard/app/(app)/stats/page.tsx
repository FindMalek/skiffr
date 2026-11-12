import { STATS_RANGES } from "@skiffr/common/constants"
import { Button } from "@skiffr/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import type { Metadata } from "next"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { StatsView } from "@/components/stats/stats-view"
import { call } from "@/lib/api"
import { hasActivity, parseDays } from "@/lib/stats"

export const metadata: Metadata = { title: "Stats" }

/** Counted on the server from your own jobs, applications and filled fields. Days are UTC days. */
export default async function StatsPage({ searchParams }: { searchParams: Promise<{ days?: string | string[] }> }) {
  const days = parseDays((await searchParams).days)
  const stats = await call((api) => api.stats.overview({ days }))
  return (
    <>
      <PageHeader
        title="Stats"
        description="What you applied to, what came back, and how well autofill knows you."
        actions={
          <nav aria-label="Time range" className="flex flex-wrap gap-2">
            {STATS_RANGES.map((range) => (
              <Button
                key={range}
                size="sm"
                variant={range === days ? "default" : "outline"}
                render={
                  <Link
                    href={{ pathname: "/stats", query: { days: range } }}
                    aria-current={range === days ? "page" : undefined}
                  />
                }
                nativeButton={false}
              >
                {range} days
              </Button>
            ))}
          </nav>
        }
      />
      {hasActivity(stats) ? (
        <StatsView stats={stats} />
      ) : (
        <div className="p-4 md:p-6">
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nothing to count yet</EmptyTitle>
              <EmptyDescription>
                Nothing was queued, applied to or autofilled in the last {days} days. Queue a job and apply to it, and
                the numbers show up here.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" render={<Link href="/queue" />} nativeButton={false}>
                Open the queue
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      )}
    </>
  )
}
