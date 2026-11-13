import { safeErrorFields } from "./errors"
import { createErrorReporter, type ErrorReporter, type Fetch } from "./glitchtip"
import { OtlpExporter, parseHeaders } from "./otlp"
import { type Allowlist, type Attrs, allowlisted, isSafeLine, isSafeName, scrubAttrs } from "./scrub"

export type Level = "info" | "warn" | "error"

/**
 * Product events the api may send to Umami, with the props each may carry. A name or a prop that is not here is dropped.
 * Counts and enums only: never an id, a label, a value or a text.
 */
export const EVENTS = {
  ai_budget_exhausted: { limit: ["daily"] },
} as const satisfies Record<string, Allowlist>
export type EventName = keyof typeof EVENTS

export interface AiSpanInfo {
  operation: "chat" | "embed"
  model: string
  provider?: string
}

export interface AiSpanRecord {
  inputTokens?: number
  outputTokens?: number
  finishReason?: string
  /** Only sent when content capture is on (`AI_TRACE_CAPTURE_CONTENT=true`): prompts and answers hold personal data. */
  prompt?: unknown
  completion?: unknown
}

export interface AiSpan {
  record(data: AiSpanRecord): void
}

export interface Observability {
  captureError(error: unknown, context?: Record<string, unknown>): void
  /** `message` is the line shown in the log list. It must be built from scrubbed values; one that is not a plain line is replaced by `event`. */
  logEvent(level: Level, event: string, attrs?: Record<string, unknown>, message?: string): void
  track(name: EventName, props?: Record<string, unknown>): void
  count(name: string, value?: number, attrs?: Record<string, unknown>): void
  gauge(name: string, value: number, attrs?: Record<string, unknown>): void
  observe(name: string, value: number, attrs?: Record<string, unknown>): void
  traceAi<T>(info: AiSpanInfo, run: (span: AiSpan) => Promise<T>): Promise<T>
  flush(): Promise<void>
}

const NOOP_SPAN: AiSpan = { record: () => undefined }

export const noopObservability: Observability = {
  captureError: () => undefined,
  logEvent: () => undefined,
  track: () => undefined,
  count: () => undefined,
  gauge: () => undefined,
  observe: () => undefined,
  traceAi: (_info, run) => run(NOOP_SPAN),
  flush: async () => undefined,
}

export interface ObservabilityConfig {
  service: string
  environment: string
  glitchtipDsn?: string
  otlpEndpoint?: string
  otlpHeaders?: string
  umamiUrl?: string
  umamiWebsiteId?: string
  captureContent?: boolean
  fetch?: Fetch
  now?: () => number
  /** 0 turns the background flush off (tests flush by hand). */
  flushMs?: number
}

/** The variables the api reads, as `process.env` names them. Every one is optional. */
export interface ObservabilityEnv {
  GLITCHTIP_DSN?: string
  OTEL_EXPORTER_OTLP_ENDPOINT?: string
  OTEL_EXPORTER_OTLP_HEADERS?: string
  UMAMI_URL?: string
  UMAMI_WEBSITE_ID?: string
  AI_TRACE_CAPTURE_CONTENT?: string
}

export const configFromEnv = (
  env: ObservabilityEnv & Record<string, unknown>,
  base: { service: string; environment: string },
): ObservabilityConfig => ({
  ...base,
  glitchtipDsn: env.GLITCHTIP_DSN,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  otlpHeaders: env.OTEL_EXPORTER_OTLP_HEADERS,
  umamiUrl: env.UMAMI_URL,
  umamiWebsiteId: env.UMAMI_WEBSITE_ID,
  captureContent: env.AI_TRACE_CAPTURE_CONTENT === "true",
})

const CONTENT_MAX = 16_000
const outcomeOf = (error: unknown): "budget" | "error" => {
  try {
    return (error as { name?: unknown } | null)?.name === "ModelBudgetError" ? "budget" : "error"
  } catch {
    return "error"
  }
}

/** A getter on a hostile error may throw: the caller must still see its own error, not ours. */
const errorClassOf = (error: unknown): string | undefined => {
  try {
    return safeErrorFields(error).name
  } catch {
    return undefined
  }
}

/** Product events per minute; the rest are dropped, so a busy path can't open a request per call. */
const TRACK_PER_MINUTE = 60

const clip = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  try {
    return (typeof value === "string" ? value : JSON.stringify(value)).slice(0, CONTENT_MAX)
  } catch {
    return undefined
  }
}

const statusClass = (status: number) => `${Math.floor(status / 100)}xx`

export { statusClass }

/** Everything is off until its variable is set: with none set this is `noopObservability` in all but name. */
export function createObservability(config: ObservabilityConfig): Observability {
  const now = config.now ?? Date.now
  const send: Fetch = config.fetch ?? ((url, init) => fetch(url, init))
  const reporter: ErrorReporter | null = config.glitchtipDsn
    ? createErrorReporter({
        dsn: config.glitchtipDsn,
        environment: config.environment,
        service: config.service,
        fetch: send,
        now,
      })
    : null
  const otlp = config.otlpEndpoint
    ? new OtlpExporter({
        endpoint: config.otlpEndpoint,
        headers: parseHeaders(config.otlpHeaders),
        service: config.service,
        environment: config.environment,
        fetch: send,
        now,
      })
    : null
  const umami =
    config.umamiUrl && config.umamiWebsiteId
      ? { url: config.umamiUrl.replace(/\/+$/, ""), id: config.umamiWebsiteId }
      : null

  if (otlp && config.flushMs !== 0) setInterval(() => void otlp.flush(), config.flushMs ?? 15_000).unref?.()

  const tracked = new Set<Promise<unknown>>()
  let trackWindow = 0
  let trackUsed = 0

  const metric = (name: string) => (otlp && isSafeName(name) ? otlp.metrics : null)

  return {
    captureError(error, context) {
      reporter?.capture(error, { deploy_env: config.environment, ...context })
      if (!otlp) return
      const errorClass = errorClassOf(error) ?? "Error"
      const attrs = scrubAttrs({ deploy_env: config.environment, ...context, error_class: errorClass, event: "error" })
      otlp.log({
        at: now(),
        level: "error",
        event: "error",
        message: `error ${attrs.error_kind ?? "internal"}: ${errorClass}`,
        attrs,
      })
    },
    logEvent(level, event, attrs, message) {
      if (!otlp || !isSafeName(event)) return
      otlp.log({
        at: now(),
        level,
        event,
        message: isSafeLine(message) ? message : undefined,
        attrs: scrubAttrs({ deploy_env: config.environment, ...attrs, event }),
      })
    },
    track(name, props) {
      const allow = EVENTS[name] as Allowlist | undefined
      if (!umami || !allow) return
      const at = now()
      if (at - trackWindow >= 60_000) {
        trackWindow = at
        trackUsed = 0
      }
      if (++trackUsed > TRACK_PER_MINUTE) return
      const request = send(`${umami.url}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; skiffr-api)" },
        body: JSON.stringify({
          type: "event",
          payload: { website: umami.id, hostname: config.service, url: "/", name, data: allowlisted(props, allow) },
        }),
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      })
        .catch(() => undefined)
        .finally(() => tracked.delete(request))
      tracked.add(request)
    },
    count: (name, value = 1, attrs) => metric(name)?.count(name, value, scrubAttrs(attrs)),
    gauge: (name, value, attrs) => metric(name)?.gauge(name, value, scrubAttrs(attrs)),
    observe: (name, value, attrs) => metric(name)?.observe(name, value, scrubAttrs(attrs)),
    async traceAi(info, run) {
      if (!otlp) return run(NOOP_SPAN)
      const start = now()
      const data: AiSpanRecord = {}
      let outcome: "ok" | "budget" | "error" = "ok"
      let errorClass: string | undefined
      try {
        return await run({ record: (next) => Object.assign(data, next) })
      } catch (error) {
        outcome = outcomeOf(error)
        errorClass = errorClassOf(error)
        throw error
      } finally {
        const end = now()
        const labels = scrubAttrs({ operation: info.operation, model: info.model })
        otlp.metrics.count("skiffr.ai.calls", 1, { ...labels, ...scrubAttrs({ outcome }) })
        otlp.metrics.observe("skiffr.ai.duration_ms", end - start, labels)
        if (data.inputTokens)
          otlp.metrics.count("skiffr.ai.tokens", data.inputTokens, { ...labels, direction: "input" })
        if (data.outputTokens)
          otlp.metrics.count("skiffr.ai.tokens", data.outputTokens, { ...labels, direction: "output" })
        const content = config.captureContent
          ? { "gen_ai.prompt": clip(data.prompt), "gen_ai.completion": clip(data.completion) }
          : {}
        otlp.span({
          name: `${info.operation} ${labels.model ?? "unknown"}`,
          start,
          end,
          ok: outcome === "ok",
          attrs: {
            "gen_ai.operation.name": info.operation,
            ...(labels.model ? { "gen_ai.request.model": labels.model } : {}),
            ...(info.provider && scrubAttrs({ provider: info.provider }).provider
              ? { "gen_ai.system": info.provider }
              : {}),
            ...(data.inputTokens !== undefined ? { "gen_ai.usage.input_tokens": data.inputTokens } : {}),
            ...(data.outputTokens !== undefined ? { "gen_ai.usage.output_tokens": data.outputTokens } : {}),
            ...(data.finishReason && /^[a-z_-]{1,30}$/.test(data.finishReason)
              ? { "gen_ai.response.finish_reasons": data.finishReason }
              : {}),
            "skiffr.ai.outcome": outcome,
            ...(errorClass ? { "error.type": errorClass } : {}),
            ...Object.fromEntries(
              Object.entries(content).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
          },
        })
      }
    },
    async flush() {
      await Promise.all([reporter?.flush(), otlp?.flush(), Promise.allSettled([...tracked])])
    },
  }
}

let current: Observability = noopObservability

/** The api sets this once at boot. Code anywhere reads it with `getObservability()`, so no call site needs wiring and tests run with the no-op. */
export const setObservability = (next: Observability): void => {
  current = next
}
export const getObservability = (): Observability => current

export type { Attrs }
