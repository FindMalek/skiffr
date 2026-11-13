import { DISABLED, type Env, type ExporterOptions, isHttpUrl, post, type SendResult, trimSlash } from "./http.ts"

interface Config {
  base: string
  org: string
  stream: string
  auth: string
}

function configOf(env: Env): Config | null {
  const url = env.OPENOBSERVE_URL
  const auth = env.OPENOBSERVE_AUTH
  if (!isHttpUrl(url) || !auth) return null
  return {
    base: trimSlash(url),
    org: encodeURIComponent(env.OPENOBSERVE_ORG || "default"),
    stream: encodeURIComponent(env.OPENOBSERVE_STREAM || "skiffr_drift"),
    auth,
  }
}

export type OpenObserveRecord = Record<string, string | number | boolean | null>

/** JSON ingest: one array of records, each stamped in microseconds. */
export async function sendRecords(records: OpenObserveRecord[], options: ExporterOptions = {}): Promise<SendResult> {
  const config = configOf(options.env ?? process.env)
  if (!config || records.length === 0) return DISABLED
  const now = Date.now() * 1000
  const body = records.map((record) => ({ _timestamp: now, ...record }))
  return post(`${config.base}/api/${config.org}/${config.stream}/_json`, { authorization: config.auth }, body, options)
}

export interface Gauge {
  name: string
  value: number
  attributes?: Record<string, string>
  unit?: string
}

/** OTLP/HTTP JSON, one gauge data point per metric. */
export async function pushMetrics(
  gauges: Gauge[],
  options: ExporterOptions & { service?: string } = {},
): Promise<SendResult> {
  const config = configOf(options.env ?? process.env)
  if (!config || gauges.length === 0) return DISABLED
  const nanos = String(BigInt(Date.now()) * 1_000_000n)
  const body = {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: options.service ?? "skiffr-drift" } }] },
        scopeMetrics: [
          {
            scope: { name: "skiffr-telemetry" },
            metrics: gauges.map((gauge) => ({
              name: gauge.name,
              unit: gauge.unit ?? "1",
              gauge: {
                dataPoints: [
                  {
                    asDouble: gauge.value,
                    timeUnixNano: nanos,
                    attributes: Object.entries(gauge.attributes ?? {}).map(([key, value]) => ({
                      key,
                      value: { stringValue: value },
                    })),
                  },
                ],
              },
            })),
          },
        ],
      },
    ],
  }
  return post(`${config.base}/api/${config.org}/v1/metrics`, { authorization: config.auth }, body, options)
}
