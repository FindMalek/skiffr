import { STATS_MIN_SAMPLE } from "@skiffr/common/constants"
import type { StatsGroup, StatsOverview } from "@skiffr/common/schemas"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@skiffr/ui/components/table"
import { SafeText } from "@/components/queue/job-text"
import { sourceLabel } from "@/lib/queue"
import { dayText, hoursText, matchText, percentText, rate } from "@/lib/stats"
import { ColumnChart, HBars, Legend, type Part, SegmentedBar, StackedRows, TableView } from "./charts"

const JOB_PARTS = {
  applied: { label: "Applied", color: "var(--viz-1)" },
  queued: { label: "Queued", color: "var(--viz-2)" },
  skipped: { label: "Skipped", color: "var(--viz-3)" },
}

const FILL_PARTS = {
  accepted: { label: "Left as filled", color: "var(--viz-1)" },
  corrected: { label: "Corrected", color: "var(--viz-2)" },
  cleared: { label: "Cleared", color: "var(--viz-3)" },
}

const ORDINAL = ["var(--viz-o1)", "var(--viz-o2)", "var(--viz-o3)", "var(--viz-o4)"]

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-3xl tabular-nums md:text-4xl">{value}</CardTitle>
        <p className="text-muted-foreground text-sm">{note}</p>
      </CardHeader>
    </Card>
  )
}

function Section({
  title,
  description,
  className,
  children,
}: {
  title: string
  description: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

function Breakdown({
  title,
  description,
  keyHeader,
  rows,
  name,
}: {
  title: string
  description: string
  keyHeader: string
  rows: StatsGroup[]
  name: (key: string) => React.ReactNode
}) {
  return (
    <Section title={title} description={description}>
      {rows.every((row) => row.applied === 0) ? (
        <p className="text-muted-foreground text-sm">No applications in this range.</p>
      ) : (
        <Table className="sm:table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="sm:w-1/3">{keyHeader}</TableHead>
              <TableHead className="text-right text-xs sm:text-sm">Applied</TableHead>
              <TableHead className="text-right text-xs sm:text-sm">Replied</TableHead>
              <TableHead className="text-right text-xs sm:text-sm">Interview</TableHead>
              <TableHead className="text-right text-xs sm:text-sm">Offer</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Reply %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows
              .filter((row) => row.applied > 0)
              .map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="max-w-24 truncate sm:max-w-none">{name(row.key)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.applied}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.responded}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.interview}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.offer}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {percentText(rate(row.responded, row.applied))}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}
      <p className="text-muted-foreground text-xs">Reply % shows once a row has {STATS_MIN_SAMPLE} applications.</p>
    </Section>
  )
}

export function StatsView({ stats }: { stats: StatsOverview }) {
  const { stages, jobs, timeToApply, autofill } = stats
  const replyRate = rate(stages.responded, stages.applied)
  const acceptRate = rate(autofill.accepted, autofill.fields)
  const range = `the last ${stats.days} days`
  const jobParts: Part[] = (["applied", "queued", "skipped"] as const).map((key) => ({
    key,
    value: jobs[key],
    ...JOB_PARTS[key],
  }))
  const fillParts: Part[] = (["accepted", "corrected", "cleared"] as const).map((key) => ({
    key,
    value: autofill[key],
    ...FILL_PARTS[key],
  }))
  const sourceKeys = [JOB_PARTS.applied, JOB_PARTS.queued, JOB_PARTS.skipped]
  const sourceRows = [
    ...stats.bySource.map((row) => ({
      key: `s:${row.source}`,
      name: <SafeText value={sourceLabel(row.source)} max={40} />,
      counts: [row.applied, row.queued, row.skipped],
    })),
    ...(stats.otherSources
      ? [
          {
            key: "other",
            name: <span className="text-muted-foreground">Other sources</span>,
            counts: [stats.otherSources.applied, stats.otherSources.queued, stats.otherSources.skipped],
          },
        ]
      : []),
  ]
  const stageRows = [
    ["Applied", stages.applied],
    ["Replied", stages.responded],
    ["Interview", stages.interview],
    ["Offer", stages.offer],
  ] as const
  const maxHours = Math.max(...timeToApply.buckets.map((bucket) => bucket.count), 1)

  return (
    <div className="viz grid min-w-0 gap-4 p-4 md:p-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Applications" value={String(stages.applied)} note={`In ${range}`} />
        <Tile
          label="Reply rate"
          value={percentText(replyRate)}
          note={
            replyRate === null
              ? `Shown from ${STATS_MIN_SAMPLE} applications`
              : `${stages.responded} of ${stages.applied} heard back`
          }
        />
        <Tile
          label="Median time to apply"
          value={hoursText(timeToApply.medianHours)}
          note={timeToApply.count ? `From queued to applied, ${timeToApply.count} jobs` : "No applications yet"}
        />
        <Tile
          label="Autofill left as filled"
          value={percentText(acceptRate)}
          note={
            acceptRate === null
              ? `Shown from ${STATS_MIN_SAMPLE} filled fields`
              : `${autofill.accepted} of ${autofill.fields} fields, ${autofill.forms} forms`
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Applications per day" description={`UTC days, ${dayText(stats.from)} to ${dayText(stats.to)}`}>
          <ColumnChart
            label="Applications per day"
            unit="applications"
            points={stats.perDay.map((p) => ({ key: p.day, label: dayText(p.day), value: p.count }))}
            firstLabel={dayText(stats.from)}
            lastLabel={dayText(stats.to)}
          />
        </Section>
        <Section
          title="Applications per week"
          description="Weeks start on Monday (UTC). The first week only has the days in range."
        >
          <ColumnChart
            label="Applications per week"
            unit="applications"
            points={stats.perWeek.map((p) => ({ key: p.week, label: `week of ${dayText(p.week)}`, value: p.count }))}
            firstLabel={dayText(stats.perWeek[0]?.week ?? stats.from)}
            lastLabel={dayText(stats.perWeek.at(-1)?.week ?? stats.to)}
          />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Queue funnel" description={`Jobs queued in ${range}, by where they are now.`}>
          {jobParts.every((part) => part.value === 0) ? (
            <p className="text-muted-foreground text-sm">No jobs were queued in this range.</p>
          ) : (
            <>
              <SegmentedBar label="Jobs queued" parts={jobParts} />
              <Legend parts={jobParts} />
              <TableView
                caption="Jobs queued by status"
                head={["Status", "Jobs"]}
                rows={jobParts.map((part) => [part.label, part.value])}
              />
            </>
          )}
        </Section>
        <Section title="Replies" description={`Applications made in ${range}, by the furthest stage reached.`}>
          {stages.applied === 0 ? (
            <p className="text-muted-foreground text-sm">No applications in this range.</p>
          ) : (
            <>
              <HBars
                label="Applications by stage"
                color="var(--viz-o3)"
                max={stages.applied}
                rows={stageRows.map(([name, value], i) => ({
                  key: name,
                  name,
                  value,
                  color: ORDINAL[i],
                  text:
                    rate(value, stages.applied) === null
                      ? String(value)
                      : `${value} · ${percentText(rate(value, stages.applied))}`,
                }))}
              />
              {replyRate === null && (
                <p className="text-muted-foreground text-sm">
                  Percentages show from {STATS_MIN_SAMPLE} applications, before that they would only be noise.
                </p>
              )}
            </>
          )}
        </Section>
      </div>

      <Section title="By source" description="Where the jobs you queued came from, and what became of them.">
        {sourceRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No jobs were queued in this range.</p>
        ) : (
          <>
            <Legend parts={sourceKeys.map((key) => ({ key: key.label, ...key }))} />
            <StackedRows label="Jobs by source" rows={sourceRows} keys={sourceKeys} />
          </>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown
          title="By ATS"
          description="The application system the form was on."
          keyHeader="ATS"
          rows={stats.byAts}
          name={(key) => <SafeText value={key} max={40} />}
        />
        <Breakdown
          title="By match score"
          description="The match score recorded with the application."
          keyHeader="Score"
          rows={stats.byMatch}
          name={matchText}
        />
      </div>
      <Breakdown
        title="By role"
        description={`The ${stats.byRole.length} most applied job titles, capitalisation ignored.`}
        keyHeader="Role"
        rows={stats.byRole}
        name={(key) => <SafeText value={key} max={60} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Time to apply" description="How long a job waited in the queue before you applied.">
          {timeToApply.count === 0 ? (
            <p className="text-muted-foreground text-sm">No applications in this range.</p>
          ) : (
            <HBars
              label="Applications by time in the queue"
              color="var(--viz-seq)"
              rows={timeToApply.buckets.map((bucket) => ({ key: bucket.key, name: bucket.key, value: bucket.count }))}
              max={maxHours}
            />
          )}
        </Section>
        <Section
          title="Autofill"
          description="Fields skiffr filled, and what you did with them. Fields it did not touch are not counted."
        >
          {autofill.fields === 0 ? (
            <p className="text-muted-foreground text-sm">No filled fields were recorded in this range.</p>
          ) : (
            <>
              <SegmentedBar label="Filled fields" parts={fillParts} />
              <Legend parts={fillParts} />
              <TableView
                caption="Filled fields by source and outcome"
                head={["Filled from", "Fields", "Corrected", "Cleared"]}
                rows={autofill.bySource.map((row) => [row.source, row.fields, row.corrected, row.cleared])}
              />
            </>
          )}
        </Section>
      </div>
    </div>
  )
}

export function StatsSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-4 p-4 md:p-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse bg-muted motion-reduce:animate-none" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse bg-muted motion-reduce:animate-none" />
        <div className="h-72 animate-pulse bg-muted motion-reduce:animate-none" />
      </div>
      <div className="h-48 animate-pulse bg-muted motion-reduce:animate-none" />
    </div>
  )
}
