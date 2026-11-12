import { captureException, captureMessage } from "./glitchtip.ts"
import type { Env, ExporterOptions, SendResult } from "./http.ts"
import { type Gauge, type OpenObserveRecord, pushMetrics, sendRecords } from "./openobserve.ts"
import { sendUmamiEvent, type UmamiEvent } from "./umami.ts"

export { captureException, captureMessage, type Dsn, type Level, parseDsn } from "./glitchtip.ts"
export type { Env, ExporterOptions, SendResult } from "./http.ts"
export { type Gauge, type OpenObserveRecord, pushMetrics, sendRecords } from "./openobserve.ts"
export { sendUmamiEvent, type UmamiEvent } from "./umami.ts"

/** The same exporters with one env and fetch bound, for callers that read the environment once. */
export function fromEnv(env: Env, fetchImpl?: typeof fetch) {
  const options: ExporterOptions = { env, fetch: fetchImpl }
  return {
    sendRecords: (records: OpenObserveRecord[]): Promise<SendResult> => sendRecords(records, options),
    pushMetrics: (gauges: Gauge[], service?: string): Promise<SendResult> =>
      pushMetrics(gauges, { ...options, service }),
    sendUmamiEvent: (event: UmamiEvent): Promise<SendResult> => sendUmamiEvent(event, options),
    captureMessage: (level: Parameters<typeof captureMessage>[0], message: string, extra?: Record<string, unknown>) =>
      captureMessage(level, message, extra, options),
    captureException: (error: unknown, extra?: Record<string, unknown>) => captureException(error, extra, options),
  }
}
