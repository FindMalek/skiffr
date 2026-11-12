import {
  createThrottle,
  DISABLED,
  type ExporterOptions,
  isHttpUrl,
  post,
  type SendResult,
  type Throttle,
  trimSlash,
} from "./http.ts"

/** Events per minute this process may send to Umami. */
const EVENTS_PER_MINUTE = 20
const shared = createThrottle(EVENTS_PER_MINUTE, 60_000)

export interface UmamiEvent {
  name: string
  /** Page path the event belongs to, default `/`. */
  url?: string
  data?: Record<string, string | number | boolean>
}

/** A custom event on a site tracked by Umami. No cookies, no ip: the server sees only what is sent here. */
export async function sendUmamiEvent(
  event: UmamiEvent,
  options: ExporterOptions & { throttle?: Throttle } = {},
): Promise<SendResult> {
  const env = options.env ?? process.env
  const base = env.UMAMI_URL
  const website = env.UMAMI_WEBSITE_ID
  if (!isHttpUrl(base) || !website) return DISABLED
  if (!(options.throttle ?? shared).allow()) return { sent: false, error: "throttled" }
  const hostname = env.UMAMI_HOSTNAME || new URL(base).hostname
  return post(
    `${trimSlash(base)}/api/send`,
    {},
    { type: "event", payload: { website, hostname, url: event.url ?? "/", name: event.name, data: event.data } },
    options,
  )
}
