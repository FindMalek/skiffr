import { DISABLED, type ExporterOptions, isHttpUrl, post, type SendResult, trimSlash } from "./http.ts"

export interface UmamiEvent {
  name: string
  /** Page path the event belongs to, default `/`. */
  url?: string
  data?: Record<string, string | number | boolean>
}

/** A custom event on a site tracked by Umami. No cookies, no ip: the server sees only what is sent here. */
export async function sendUmamiEvent(event: UmamiEvent, options: ExporterOptions = {}): Promise<SendResult> {
  const env = options.env ?? process.env
  const base = env.UMAMI_URL
  const website = env.UMAMI_WEBSITE_ID
  if (!isHttpUrl(base) || !website) return DISABLED
  const hostname = env.UMAMI_HOSTNAME || new URL(base).hostname
  return post(
    `${trimSlash(base)}/api/send`,
    {},
    { type: "event", payload: { website, hostname, url: event.url ?? "/", name: event.name, data: event.data } },
    options,
  )
}
