import type { Fetch } from "./glitchtip"
import type { Attrs } from "./scrub"

type Value = string | number | boolean

const nanos = (ms: number): string => String(BigInt(Math.round(ms)) * 1_000_000n)

function encode(value: Value): Record<string, string | number | boolean> | { intValue: string } {
  if (typeof value === "string") return { stringValue: value }
  if (typeof value === "boolean") return { boolValue: value }
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
}

export const toOtlpAttributes = (attrs: Record<string, Value>) =>
  Object.entries(attrs).map(([key, value]) => ({ key, value: encode(value) }))

const hex = (bytes: number): string =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("")

export interface LogRecord {
  at: number
  level: "info" | "warn" | "error"
  event: string
  attrs: Attrs
}

export interface SpanRecord {
  name: string
  start: number
  end: number
  ok: boolean
  /** Already scrubbed by the caller: this module encodes whatever it gets. */
  attrs: Record<string, Value>
}

const SEVERITY = { info: 9, warn: 13, error: 17 } as const
const BUCKETS = [5, 25, 100, 250, 500, 1000, 2500, 5000, 10_000]
const MAX_SERIES = 1000

interface Series {
  name: string
  attrs: Attrs
}
interface Counter extends Series {
  value: number
}
interface Histogram extends Series {
  count: number
  sum: number
  buckets: number[]
}

const seriesKey = (name: string, attrs: Attrs) =>
  `${name}|${Object.keys(attrs)
    .sort()
    .map((key) => `${key}=${attrs[key]}`)
    .join(",")}`

/** In-process aggregation, exported as cumulative OTLP metrics. Bounded: a new series past the cap is dropped. */
export class MetricStore {
  private counters = new Map<string, Counter>()
  private gauges = new Map<string, Counter>()
  private histograms = new Map<string, Histogram>()

  constructor(private startedAt: number) {}

  private size = () => this.counters.size + this.gauges.size + this.histograms.size

  count(name: string, value: number, attrs: Attrs): void {
    const key = seriesKey(name, attrs)
    const found = this.counters.get(key)
    if (found) found.value += value
    else if (this.size() < MAX_SERIES) this.counters.set(key, { name, attrs, value })
  }

  gauge(name: string, value: number, attrs: Attrs): void {
    const key = seriesKey(name, attrs)
    const found = this.gauges.get(key)
    if (found) found.value = value
    else if (this.size() < MAX_SERIES) this.gauges.set(key, { name, attrs, value })
  }

  observe(name: string, value: number, attrs: Attrs): void {
    const key = seriesKey(name, attrs)
    let found = this.histograms.get(key)
    if (!found && this.size() < MAX_SERIES) {
      found = { name, attrs, count: 0, sum: 0, buckets: new Array(BUCKETS.length + 1).fill(0) }
      this.histograms.set(key, found)
    }
    if (!found) return
    found.count++
    found.sum += value
    const index = BUCKETS.findIndex((bound) => value <= bound)
    const slot = index === -1 ? BUCKETS.length : index
    found.buckets[slot] = (found.buckets[slot] ?? 0) + 1
  }

  isEmpty = () => this.size() === 0

  collect(now: number) {
    const base = { startTimeUnixNano: nanos(this.startedAt), timeUnixNano: nanos(now) }
    const group = <T extends Series>(map: Map<string, T>, point: (item: T) => object) => {
      const byName = new Map<string, object[]>()
      for (const item of map.values()) {
        const points = byName.get(item.name) ?? []
        points.push({ ...base, attributes: toOtlpAttributes(item.attrs), ...point(item) })
        byName.set(item.name, points)
      }
      return byName
    }
    return [
      ...[...group(this.counters, (c) => ({ asDouble: c.value }))].map(([name, dataPoints]) => ({
        name,
        sum: { dataPoints, aggregationTemporality: 2, isMonotonic: true },
      })),
      ...[...group(this.gauges, (g) => ({ asDouble: g.value }))].map(([name, dataPoints]) => ({
        name,
        gauge: { dataPoints },
      })),
      ...[
        ...group(this.histograms, (h) => ({
          count: String(h.count),
          sum: h.sum,
          bucketCounts: h.buckets.map(String),
          explicitBounds: BUCKETS,
        })),
      ].map(([name, dataPoints]) => ({ name, histogram: { dataPoints, aggregationTemporality: 2 } })),
    ]
  }
}

export interface OtlpOptions {
  /** Base url up to the org, e.g. `http://openobserve:5080/api/default`: `/v1/logs`, `/v1/metrics` and `/v1/traces` are appended. */
  endpoint: string
  headers: Record<string, string>
  service: string
  environment: string
  fetch?: Fetch
  now?: () => number
  /** Records kept between flushes; the oldest go first. */
  maxQueue?: number
}

/** `OTEL_EXPORTER_OTLP_HEADERS` format: `key=value,key=value`. */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of (raw ?? "").split(",")) {
    const at = pair.indexOf("=")
    if (at > 0) headers[pair.slice(0, at).trim().toLowerCase()] = decodeURIComponent(pair.slice(at + 1).trim())
  }
  return headers
}

export class OtlpExporter {
  readonly metrics: MetricStore
  private logs: LogRecord[] = []
  private spans: SpanRecord[] = []
  private send: Fetch
  private now: () => number
  private maxQueue: number
  private resource: { attributes: ReturnType<typeof toOtlpAttributes> }

  constructor(private options: OtlpOptions) {
    this.send = options.fetch ?? ((url, init) => fetch(url, init))
    this.now = options.now ?? Date.now
    this.maxQueue = options.maxQueue ?? 500
    this.metrics = new MetricStore(this.now())
    this.resource = {
      attributes: toOtlpAttributes({
        "service.name": options.service,
        "deployment.environment.name": options.environment,
      }),
    }
  }

  log(record: LogRecord): void {
    this.logs.push(record)
    if (this.logs.length > this.maxQueue) this.logs.shift()
  }

  span(record: SpanRecord): void {
    this.spans.push(record)
    if (this.spans.length > this.maxQueue) this.spans.shift()
  }

  private post(path: string, body: object): Promise<void> {
    return this.send(`${this.options.endpoint.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.options.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    }).then(
      () => undefined,
      () => undefined,
    )
  }

  /** Never throws and never waits on the network for longer than the timeout. What a failed post held is not retried. */
  async flush(): Promise<void> {
    const logs = this.logs.splice(0)
    const spans = this.spans.splice(0)
    const metrics = this.metrics.isEmpty() ? [] : this.metrics.collect(this.now())
    const scope = { name: "skiffr" }
    const sends: Promise<void>[] = []
    if (logs.length > 0)
      sends.push(
        this.post("/v1/logs", {
          resourceLogs: [
            {
              resource: this.resource,
              scopeLogs: [
                {
                  scope,
                  logRecords: logs.map((log) => ({
                    timeUnixNano: nanos(log.at),
                    severityNumber: SEVERITY[log.level],
                    severityText: log.level.toUpperCase(),
                    body: { stringValue: log.event },
                    attributes: toOtlpAttributes(log.attrs),
                  })),
                },
              ],
            },
          ],
        }),
      )
    if (spans.length > 0)
      sends.push(
        this.post("/v1/traces", {
          resourceSpans: [
            {
              resource: this.resource,
              scopeSpans: [
                {
                  scope,
                  spans: spans.map((span) => ({
                    traceId: hex(16),
                    spanId: hex(8),
                    name: span.name,
                    kind: 3,
                    startTimeUnixNano: nanos(span.start),
                    endTimeUnixNano: nanos(span.end),
                    attributes: toOtlpAttributes(span.attrs),
                    status: { code: span.ok ? 1 : 2 },
                  })),
                },
              ],
            },
          ],
        }),
      )
    if (metrics.length > 0)
      sends.push(
        this.post("/v1/metrics", {
          resourceMetrics: [{ resource: this.resource, scopeMetrics: [{ scope, metrics }] }],
        }),
      )
    await Promise.all(sends)
  }
}
