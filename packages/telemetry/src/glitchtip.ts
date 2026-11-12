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

async function sendEvent(event: Record<string, unknown>, options: ExporterOptions, env: Env): Promise<SendResult> {
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
  return post(
    dsn.endpoint,
    { "content-type": "application/x-sentry-envelope", "x-sentry-auth": auth },
    envelope,
    options,
  )
}

export function captureMessage(
  level: Level,
  message: string,
  extra: Record<string, unknown> = {},
  options: ExporterOptions = {},
): Promise<SendResult> {
  return sendEvent({ level, message, extra }, options, options.env ?? process.env)
}

export function captureException(
  error: unknown,
  extra: Record<string, unknown> = {},
  options: ExporterOptions = {},
): Promise<SendResult> {
  const type = error instanceof Error ? error.name : "Error"
  const value = error instanceof Error ? error.message : String(error)
  const frames = (error instanceof Error ? (error.stack ?? "") : "")
    .split("\n")
    .slice(1)
    .map((line) => ({ filename: line.trim() }))
    .reverse()
  return sendEvent(
    { level: "error", exception: { values: [{ type, value, stacktrace: { frames } }] }, extra },
    options,
    options.env ?? process.env,
  )
}

export { safeError }
