import type { Baseline, DriftReport, Severity, SmokeResult, SmokeTarget, TargetReport } from "./schema.ts"

const SIGNATURE_NOTE = /field signature changed/i
const LOST = /no fill offer|not detected|apply button selector/i

export function severityOf(result: SmokeResult, signatureChanged: boolean): Severity {
  const seen = result.observation
  if (result.status === "drift" || result.status === "ok") {
    if (seen && (seen.sensitiveFilled > 0 || seen.sensitiveAsked > 0)) return "critical"
    if (result.status === "drift") {
      if ((seen && (!seen.toast || seen.clickMissed)) || result.reasons.some((reason) => LOST.test(reason)))
        return "high"
      return "medium"
    }
    if (signatureChanged) return "low"
  }
  return "none"
}

/** Drift, or a sensitive field that was asked about or filled: a privacy regression is never "ok". */
export const isAlarm = (row: { status: string; severity: string }): boolean =>
  row.status === "drift" || row.severity === "critical"

export interface BuildInput {
  results: SmokeResult[]
  baselines: Map<string, Baseline>
  targets: Map<string, SmokeTarget>
  previous: DriftReport | null
  now: Date
}

export function buildReport({ results, baselines, targets, previous, now }: BuildInput): DriftReport {
  const before = new Set(previous?.targets.filter(isAlarm).map((target) => target.id))
  const rows: TargetReport[] = results.map((result) => {
    const baseline = baselines.get(result.id)
    const seen = result.observation
    const signatureChanged = result.notes.some((note) => SIGNATURE_NOTE.test(note))
    const severity = severityOf(result, signatureChanged)
    const drifted = isAlarm({ status: result.status, severity })
    const target = targets.get(result.id)
    return {
      id: result.id,
      ats: result.ats,
      status: result.status,
      severity,
      reasons: result.reasons,
      notes: result.notes,
      filled: seen?.filled ?? null,
      collected: seen?.collected ?? null,
      deltas:
        seen && baseline
          ? { filled: seen.filled - baseline.filled, collected: seen.collected - baseline.collected }
          : null,
      signatureChanged,
      newSince: drifted && !before.has(result.id),
      persisting: drifted && before.has(result.id),
      url: target?.url ?? null,
      click: target?.click ?? null,
    }
  })
  const count = (status: string): number => rows.filter((row) => row.status === status).length
  const severity = (level: Severity): number => rows.filter((row) => row.severity === level).length
  const now_ids = new Set(rows.filter(isAlarm).map((row) => row.id))
  const drift = count("drift")
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    drifted: drift > 0 || severity("critical") > 0,
    totals: {
      targets: rows.length,
      drift,
      changed: rows.filter((row) => row.severity !== "none").length,
      ok: count("ok"),
      gone: count("gone"),
      blocked: count("blocked"),
      error: count("error"),
      skipped: count("skipped"),
      bySeverity: {
        critical: severity("critical"),
        high: severity("high"),
        medium: severity("medium"),
        low: severity("low"),
      },
    },
    targets: rows,
    resolved: [...before].filter((id) => !now_ids.has(id)),
  }
}

const ZWSP = "\u200b"
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose
const INVISIBLE = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\u200b-\u200f]/g
const CELL_MAX = 200

/**
 * Text that came from a page ends up in an issue the bot writes: no mention, link, image, heading, html or table
 * break may survive, and nothing may be long enough to push the body over what github accepts.
 */
export function escapeMd(text: string, max = CELL_MAX): string {
  const flat = text
    .replace(INVISIBLE, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
  const cut = flat.length > max ? `${flat.slice(0, max)}...` : flat
  return cut
    .replace(/([\\`*_{}[\]()#+!|<>~])/g, "\\$1")
    .replace(/@/g, `@${ZWSP}`)
    .replace(/#/g, `#${ZWSP}`)
    .replace(/:\/\//g, `:${ZWSP}//`)
    .replace(/www\./gi, `www${ZWSP}.`)
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))

export const BODY_MAX = 60_000
export const MARKER = "<!-- skiffr-drift-report -->"

/** The body of the tracking issue: lowercase, plain, one table, under the size github accepts. */
export function renderMarkdown(report: DriftReport): string {
  const { totals } = report
  const head = report.drifted
    ? `drift on ${totals.drift} of ${totals.targets} real pages (critical ${totals.bySeverity.critical}, high ${totals.bySeverity.high}, medium ${totals.bySeverity.medium})`
    : `no drift on ${totals.targets} real pages`
  const title =
    totals.bySeverity.critical > 0
      ? `critical: a sensitive field was touched on ${totals.bySeverity.critical} real page${totals.bySeverity.critical === 1 ? "" : "s"}. ${head}`
      : head
  const interesting = report.targets.filter((row) => row.severity !== "none" || row.status === "error")
  const rows = interesting.map((row) => {
    const delta = row.deltas ? `filled ${signed(row.deltas.filled)}, collected ${signed(row.deltas.collected)}` : ""
    const age = row.newSince ? "new" : row.persisting ? "persisting" : ""
    const detail = [...row.reasons, ...row.notes, delta].filter(Boolean).join("; ")
    return `| ${[escapeMd(row.id, 64), escapeMd(row.ats, 32), row.status, row.severity, age, escapeMd(detail)].join(" | ")} |`
  })
  const lines = [`drift report ${report.generatedAt.slice(0, 10)}: ${title}`, ""]
  if (rows.length > 0) {
    lines.push("| target | ats | status | severity | since | detail |", "| --- | --- | --- | --- | --- | --- |")
    let size = lines.join("\n").length
    let shown = 0
    for (const row of rows) {
      if (size + row.length + 1 > BODY_MAX - 2_000) break
      lines.push(row)
      size += row.length + 1
      shown += 1
    }
    if (shown < rows.length)
      lines.push("", `and ${rows.length - shown} more rows, the full report is in the run artifact`)
    lines.push("")
  }
  if (report.resolved.length > 0) {
    lines.push(`back to normal since the last report: ${report.resolved.map((id) => escapeMd(id, 64)).join(", ")}`, "")
  }
  lines.push(
    `gone ${totals.gone}, blocked ${totals.blocked}, skipped ${totals.skipped}, errors ${totals.error}: these say nothing about the extension.`,
    "",
    "a sanitized snapshot of each changed page is in the run artifact. turn it into an adapter fixture by hand, nothing is committed for you.",
    "",
    MARKER,
    "",
  )
  return lines.join("\n")
}
