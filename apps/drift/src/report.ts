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

export interface BuildInput {
  results: SmokeResult[]
  baselines: Map<string, Baseline>
  targets: Map<string, SmokeTarget>
  previous: DriftReport | null
  now: Date
}

export function buildReport({ results, baselines, targets, previous, now }: BuildInput): DriftReport {
  const before = new Set(previous?.targets.filter((target) => target.status === "drift").map((target) => target.id))
  const rows: TargetReport[] = results.map((result) => {
    const baseline = baselines.get(result.id)
    const seen = result.observation
    const signatureChanged = result.notes.some((note) => SIGNATURE_NOTE.test(note))
    const drifted = result.status === "drift"
    const target = targets.get(result.id)
    return {
      id: result.id,
      ats: result.ats,
      status: result.status,
      severity: severityOf(result, signatureChanged),
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
  const now_ids = new Set(rows.filter((row) => row.status === "drift").map((row) => row.id))
  const drift = count("drift")
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    drifted: drift > 0,
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

const dash = (text: string): string => text.replace(/[–—]/g, "-")
const cell = (text: string): string => dash(text).replace(/\|/g, "/").replace(/\s+/g, " ")
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))

/** The body of the tracking issue: lowercase, plain, one table. */
export function renderMarkdown(report: DriftReport): string {
  const { totals } = report
  const head = report.drifted
    ? `drift on ${totals.drift} of ${totals.targets} real pages (critical ${totals.bySeverity.critical}, high ${totals.bySeverity.high}, medium ${totals.bySeverity.medium})`
    : `no drift on ${totals.targets} real pages`
  const interesting = report.targets.filter((row) => row.severity !== "none" || row.status === "error")
  const rows = interesting.map((row) => {
    const delta = row.deltas ? `filled ${signed(row.deltas.filled)}, collected ${signed(row.deltas.collected)}` : ""
    const age = row.newSince ? "new" : row.persisting ? "persisting" : ""
    const detail = [...row.reasons, ...row.notes, delta].filter(Boolean).join("; ")
    return `| ${[row.id, row.ats, row.status, row.severity, age, cell(detail)].join(" | ")} |`
  })
  const lines = [`drift report ${report.generatedAt.slice(0, 10)}: ${head}`, ""]
  if (rows.length > 0) {
    lines.push(
      "| target | ats | status | severity | since | detail |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows,
      "",
    )
  }
  if (report.resolved.length > 0) lines.push(`back to normal since the last report: ${report.resolved.join(", ")}`, "")
  lines.push(
    `gone ${totals.gone}, blocked ${totals.blocked}, skipped ${totals.skipped}, errors ${totals.error}: these say nothing about the extension.`,
    "",
    "a sanitized snapshot of each changed page is in the run artifact. turn it into an adapter fixture by hand, nothing is committed for you.",
    "",
  )
  return lines.join("\n")
}
