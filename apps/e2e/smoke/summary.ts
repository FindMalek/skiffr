import { STATUSES, type Status, type TargetResult } from "./drift.ts"

const cell = (text: string): string => text.replace(/\|/g, "/").replace(/\s+/g, " ")

export function tally(results: TargetResult[]): Record<Status, number> {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<Status, number>
  for (const result of results) counts[result.status]++
  return counts
}

/** A run is red only when the extension drifted or the runner itself failed: a gone or blocked page says nothing about the extension. */
export const needsAttention = (results: TargetResult[]): boolean =>
  results.some((result) => result.status === "drift" || result.status === "error")

export function renderSummary(results: TargetResult[], date: string): string {
  const counts = tally(results)
  const line = STATUSES.filter((status) => counts[status] > 0)
    .map((status) => `${status} ${counts[status]}`)
    .join(", ")
  const rows = results.map((result) => {
    const seen = result.observation
    const numbers = seen
      ? [
          seen.collected,
          seen.filled,
          seen.outlined,
          seen.left,
          `${seen.sensitiveAsked}/${seen.sensitiveFilled}`,
          seen.consoleErrors,
        ]
      : ["", "", "", "", "", ""]
    const detail = [...result.reasons, ...result.notes].join("; ")
    return `| ${[result.id, result.ats, result.status, ...numbers, Math.round(result.ms / 1000), cell(detail)].join(" | ")} |`
  })
  return [
    `smoke run ${date}: ${line || "no targets"}`,
    "",
    "| target | ats | status | collected | filled | outlined | left | sensitive asked/filled | console errors | seconds | detail |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}
