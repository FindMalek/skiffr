export type Env = Record<string, string | undefined>

export interface ExporterOptions {
  env?: Env
  fetch?: typeof fetch
  timeoutMs?: number
}

export type SendResult =
  | { sent: true; status: number }
  | { sent: false; reason: "disabled" }
  | { sent: false; error: string }

export const DISABLED: SendResult = { sent: false, reason: "disabled" }

export const USER_AGENT = "skiffr-telemetry/0.1"

/** An error text that never carries a url, header or body: those can hold secrets. */
export function safeError(error: unknown): string {
  if (error instanceof Error) return error.name === "Error" ? "request failed" : error.name
  return "request failed"
}

export async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: ExporterOptions,
): Promise<SendResult> {
  const doFetch = options.fetch ?? fetch
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    })
    if (!response.ok) return { sent: false, error: `http ${response.status}` }
    return { sent: true, status: response.status }
  } catch (error) {
    return { sent: false, error: safeError(error) }
  }
}

export const trimSlash = (url: string): string => url.replace(/\/+$/, "")

export function isHttpUrl(raw: string | undefined): raw is string {
  if (!raw) return false
  try {
    const url = new URL(raw)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}
