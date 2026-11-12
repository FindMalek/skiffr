import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@skiffr/ui/components/table"
import { cn } from "@skiffr/ui/lib/utils"
import type { CSSProperties } from "react"
import { niceMax } from "@/lib/stats"

export type Part = { key: string; label: string; value: number; color: string }

export function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-4 text-sm">
      <summary className="w-fit cursor-pointer text-muted-foreground underline-offset-4 hover:underline focus-visible:underline">
        Show as table
      </summary>
      <div className="mt-2 max-h-56 overflow-y-auto">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {head.map((cell, i) => (
                <TableHead key={cell} className={cn(i > 0 && "text-right")}>
                  {cell}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={String(row[0])}>
                {row.map((cell, i) => (
                  <TableCell key={head[i]} className={cn(i > 0 && "text-right tabular-nums")}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  )
}

export function ColumnChart({
  label,
  unit,
  points,
  firstLabel,
  lastLabel,
}: {
  label: string
  unit: string
  points: { key: string; label: string; value: number }[]
  firstLabel: string
  lastLabel: string
}) {
  const top = niceMax(Math.max(...points.map((p) => p.value), 0))
  const ticks = Number.isInteger(top / 2) ? [top, top / 2, 0] : [top, 0]
  const total = points.reduce((sum, p) => sum + p.value, 0)
  return (
    <div>
      <div className="flex gap-2">
        <div aria-hidden="true" className="relative h-40 w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 bottom-(--at) translate-y-1/2 leading-none"
              style={{ "--at": `${(tick / top) * 100}%` } as CSSProperties}
            >
              {tick}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={`${label}: ${total} ${unit} in ${points.length} ${points.length === 1 ? "bar" : "bars"}. The table below has every value.`}
          className="relative h-40 min-w-0 flex-1 border-b"
        >
          {ticks.slice(0, -1).map((tick) => (
            <div
              key={tick}
              aria-hidden="true"
              className="absolute inset-x-0 bottom-(--at) border-t"
              style={{ "--at": `${(tick / top) * 100}%` } as CSSProperties}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-px sm:gap-0.5">
            {points.map((point, i) => (
              <div key={point.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
                <div
                  className={cn(
                    "viz-mark viz-grow-y h-(--h) w-full max-w-6 rounded-t-sm bg-(--viz-seq) group-hover:opacity-80",
                    point.value > 0 && "min-h-0.5",
                  )}
                  style={{ "--h": `${(point.value / top) * 100}%` } as CSSProperties}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute bottom-full z-10 hidden whitespace-nowrap border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-sm group-hover:block",
                    i < points.length / 2 ? "left-0" : "right-0",
                  )}
                >
                  <strong className="font-semibold tabular-nums">{point.value}</strong> {unit}, {point.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between pl-9 text-muted-foreground text-xs">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
      <TableView caption={label} head={["Period", unit]} rows={points.map((p) => [p.label, p.value])} />
    </div>
  )
}

export function Legend({ parts }: { parts: Pick<Part, "key" | "label" | "color">[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {parts.map((part) => (
        <li key={part.key} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="viz-mark size-2.5 bg-(--c)"
            style={{ "--c": part.color } as CSSProperties}
          />
          {part.label}
        </li>
      ))}
    </ul>
  )
}

/** One whole in parts. Tall: the count is printed on a block that is wide enough for it, otherwise it is only in the table. */
export function SegmentedBar({ label, parts }: { label: string; parts: Part[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  return (
    <div
      role="img"
      aria-label={`${label}: ${parts.map((part) => `${part.value} ${part.label.toLowerCase()}`).join(", ")}`}
      className="flex h-7 gap-0.5"
    >
      {parts
        .filter((part) => part.value > 0)
        .map((part) => (
          <div
            key={part.key}
            title={`${part.label}: ${part.value}`}
            className="viz-mark viz-grow-x min-w-0 grow-(--n) basis-0 rounded-xs bg-(--c) px-2 font-medium text-white text-xs leading-7"
            style={{ "--n": part.value, "--c": part.color } as CSSProperties}
          >
            {part.value / total >= 0.12 ? part.value : null}
          </div>
        ))}
    </div>
  )
}

export type BarRow = { key: string; name: React.ReactNode; value: number; color?: string; text?: string }

/** One bar per named row on a shared scale, the figure at the tip. */
export function HBars({ label, rows, color, max }: { label: string; rows: BarRow[]; color: string; max?: number }) {
  const scale = max ?? Math.max(...rows.map((row) => row.value), 1)
  return (
    <ul aria-label={label} className="flex flex-col gap-2 text-sm">
      {rows.map((row) => (
        <li key={row.key} className="viz-row">
          <span className="min-w-0 truncate">{row.name}</span>
          <span aria-hidden="true" className="flex h-3 items-center">
            <span
              className={cn(
                "viz-mark viz-grow-x block h-full w-(--w) rounded-r-sm bg-(--c)",
                row.value > 0 && "min-w-0.5",
              )}
              style={{ "--w": `${(row.value / scale) * 100}%`, "--c": row.color ?? color } as CSSProperties}
            />
          </span>
          <span className="min-w-8 text-right tabular-nums">{row.text ?? row.value}</span>
        </li>
      ))}
    </ul>
  )
}

/** A thin stacked bar per row, every bar on the same scale. The names of the parts come from one legend above. */
export function StackedRows({
  label,
  rows,
  keys,
}: {
  label: string
  rows: { key: string; name: React.ReactNode; counts: number[] }[]
  keys: { label: string; color: string }[]
}) {
  const scale = Math.max(...rows.map((row) => row.counts.reduce((a, b) => a + b, 0)), 1)
  return (
    <ul aria-label={label} className="flex flex-col gap-2 text-sm">
      {rows.map((row) => {
        const total = row.counts.reduce((a, b) => a + b, 0)
        return (
          <li key={row.key} className="viz-row">
            <span className="min-w-0 truncate">{row.name}</span>
            <span aria-hidden="true" className="flex h-2">
              <span
                className="flex h-full w-(--w) gap-0.5"
                style={{ "--w": `${(total / scale) * 100}%` } as CSSProperties}
              >
                {row.counts.map((count, i) =>
                  count > 0 ? (
                    <span
                      key={keys[i]!.label}
                      className="viz-mark viz-grow-x min-w-0 grow-(--n) basis-0 rounded-full bg-(--c)"
                      style={{ "--n": count, "--c": keys[i]!.color } as CSSProperties}
                    />
                  ) : null,
                )}
              </span>
            </span>
            <span className="min-w-8 text-right tabular-nums">{total}</span>
            <span className="sr-only">
              {row.counts.map((count, i) => `${count} ${keys[i]!.label.toLowerCase()}`).join(", ")}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
