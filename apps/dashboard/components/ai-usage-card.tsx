import type { AiUsage } from "@skiffr/common/schemas"
import { Card, CardContent } from "@skiffr/ui/components/card"
import { ErrorState } from "@skiffr/ui/components/error-state"
import { Section } from "@skiffr/ui/components/section"
import type { CSSProperties } from "react"
import { RetryButton } from "@/components/settings/retry-button"
import { Time } from "@/components/time"
import { meterText, resetsAt, type UsageRow, usageRows } from "@/lib/ai-usage-copy"

function UsageMeter({ row }: { row: UsageRow }) {
  const labelId = `ai-usage-${row.id}`
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span id={labelId} className="font-medium">
          {row.label}
        </span>
        <span className="tabular-nums">
          {row.used}
          {row.left && <span className="text-muted-foreground">{`, ${row.left}`}</span>}
        </span>
      </div>
      {row.percent !== null && (
        // biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be drawn as a flat black on white bar across engines
        <div
          role="meter"
          aria-labelledby={labelId}
          aria-valuetext={meterText(row)}
          aria-valuemin={0}
          aria-valuemax={row.limit}
          aria-valuenow={row.value}
          className="h-3 border border-border-strong forced-colors:border-[ButtonText]"
        >
          <div
            className="h-full w-(--used) bg-foreground forced-colors:forced-color-adjust-none forced-colors:bg-[Highlight]"
            style={{ "--used": `${row.percent}%` } as CSSProperties}
          />
        </div>
      )}
    </li>
  )
}

export function AiUsageCard({ usage }: { usage: AiUsage | null }) {
  const rows = usage ? usageRows(usage) : []
  const unlimited = usage ? usage.limits.calls <= 0 && usage.limits.tokens <= 0 : false
  const reset = usage && !unlimited ? resetsAt(usage) : null
  return (
    <Section
      title="AI use"
      description="What skiffr asked a model for you today: resume tailoring, drafts and answer mapping."
    >
      {usage ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-4">
              {rows.map((row) => (
                <UsageMeter key={row.id} row={row} />
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              {unlimited && "No daily limit."}
              {!unlimited && !reset && "Resets daily at midnight UTC."}
              {reset && (
                <>
                  Resets daily at midnight UTC, next on <Time value={reset} mode="absolute" />
                </>
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ErrorState
          title="AI use could not load"
          description="skiffr could not read today's usage. Your usage is not affected."
          action={<RetryButton />}
        />
      )}
    </Section>
  )
}
