import { DISABLED, type Env, type ExporterOptions, post, type SendResult, safeError } from "./http.ts"

export interface Dsn {
  key: string
  endpoint: string
}

/** `https://<key>@host[:port]/<project>`: anything else is rejected without echoing it. */
export function parseDsn(raw: string | undefined): Dsn | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    const project = url.pathname.split("/").filter(Boolean).pop()
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.username || !project) return null
    if (!/^\d+$/.test(project)) return null
    return { key: url.username, endpoint: `${url.protocol}//${url.host}/api/${project}/envelope/` }
  } catch {
    return null
  }
}

export type Level = "fatal" | "error" | "warning" | "info"

function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "")
}

const MAX_TEXT = 300

type Scalar = string | number | boolean

/** Only short scalars leave the process: an object or a page derived list is dropped, so a caller cannot leak a payload by accident. */
function scalars(extra: Record<string, unknown>): Record<string, Scalar> {
  const out: Record<string, Scalar> = {}
  for (const [key, value] of Object.entries(extra).slice(0, 20)) {
    if (typeof value === "string") out[key.slice(0, 40)] = value.slice(0, MAX_TEXT)
    else if (typeof value === "number" || typeof value === "boolean") out[key.slice(0, 40)] = value
  }
  return out
}

async function sendEvent(event: Record<string, unknown>, options: ExporterOptions, env: Env): Promise<SendResult> {
  try {
    const dsn = parseDsn(env.GLITCHTIP_DSN)
    if (!dsn) return DISABLED
    const eventId = randomId()
    const full = { event_id: eventId, timestamp: Date.now() / 1000, platform: "node", ...event }
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(full),
    ].join("\n")
    const auth = `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=skiffr-telemetry/0.1`
    return await post(
      dsn.endpoint,
      { "content-type": "application/x-sentry-envelope", "x-sentry-auth": auth },
      envelope,
      options,
    )
  } catch (error) {
    return { sent: false, error: safeError(error) }
  }
}

export function captureMessage(
  level: Level,
  message: string,
  extra: Record<string, unknown> = {},
  options: ExporterOptions = {},
): Promise<SendResult> {
  return sendEvent(
    { level, message: message.slice(0, MAX_TEXT), extra: scalars(extra) },
    options,
    options.env ?? process.env,
  )
}

/** Sends the error class and the scalar extras. The message and the stack can hold page or user text, so they stay home. */
export function captureException(
  error: unknown,
  extra: Record<string, unknown> = {},
  options: ExporterOptions = {},
): Promise<SendResult> {
  const type = error instanceof Error ? error.name.slice(0, 80) : "Error"
  return sendEvent(
    { level: "error", exception: { values: [{ type, value: "redacted" }] }, extra: scalars(extra) },
    options,
    options.env ?? process.env,
  )
}

export { safeError }
