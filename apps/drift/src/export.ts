import {
  captureMessage,
  type Env,
  type ExporterOptions,
  pushMetrics,
  type SendResult,
  sendRecords,
  sendUmamiEvent,
} from "@skiffr/telemetry"
import type { DriftReport } from "./schema.ts"

export interface ExportOutcome {
  openobserve: SendResult
  metrics: SendResult
  umami: SendResult
  glitchtip: SendResult
}

/** Every exporter is optional: one that has no env set reports `disabled` and the rest still run. */
export async function exportReport(report: DriftReport, env: Env, fetchImpl?: typeof fetch): Promise<ExportOutcome> {
  const options: ExporterOptions = { env, fetch: fetchImpl }
  const at = report.generatedAt
  const records = [
    {
      kind: "run",
      at,
      drifted: report.drifted,
      targets: report.totals.targets,
      drift: report.totals.drift,
      critical: report.totals.bySeverity.critical,
      high: report.totals.bySeverity.high,
      medium: report.totals.bySeverity.medium,
      low: report.totals.bySeverity.low,
    },
    ...report.targets.map((row) => ({
      kind: "target",
      at,
      target: row.id,
      ats: row.ats,
      status: row.status,
      severity: row.severity,
      filled: row.filled,
      collected: row.collected,
      filled_delta: row.deltas?.filled ?? null,
      collected_delta: row.deltas?.collected ?? null,
      signature_changed: row.signatureChanged,
      new_since: row.newSince,
    })),
  ]
  const gauges = [
    { name: "skiffr.drift.targets", value: report.totals.targets },
    { name: "skiffr.drift.drifted", value: report.totals.drift },
    ...(["critical", "high", "medium", "low"] as const).map((severity) => ({
      name: "skiffr.drift.severity",
      value: report.totals.bySeverity[severity],
      attributes: { severity },
    })),
  ]
  const critical = report.targets.filter((row) => row.severity === "critical")
  const [openobserve, metrics, umami, glitchtip] = await Promise.all([
    sendRecords(records, options),
    pushMetrics(gauges, options),
    sendUmamiEvent(
      {
        name: report.drifted ? "drift-detected" : "drift-clean",
        url: "/drift",
        data: { targets: report.totals.targets, drift: report.totals.drift },
      },
      options,
    ),
    critical.length > 0
      ? captureMessage(
          "error",
          `critical drift on ${critical.map((row) => row.id).join(", ")}`,
          { reasons: critical.flatMap((row) => row.reasons) },
          options,
        )
      : Promise.resolve<SendResult>({ sent: false, reason: "disabled" }),
  ])
  return { openobserve, metrics, umami, glitchtip }
}
