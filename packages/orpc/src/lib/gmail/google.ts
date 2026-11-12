import { GMAIL_SCOPE } from "@skiffr/common/constants"
import { z } from "zod"
import { GoogleError } from "./errors"

export const GOOGLE_ENDPOINTS = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  gmailApi: "https://gmail.googleapis.com/gmail/v1",
} as const

export type GoogleEndpoints = { [K in keyof typeof GOOGLE_ENDPOINTS]: string }

/** Built by the api from env, by tests with the local mock's urls. Absent from `Services` means Gmail is not configured. */
export interface GmailRuntime {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Where the user lands after consent: the dashboard origin. */
  dashboardUrl: string
  /** 32 byte key that seals refresh tokens and signs `state`. */
  key: Buffer
  syncIntervalMinutes: number
  endpoints: GoogleEndpoints
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
}

const TIMEOUT_MS = 15_000
const SMALL_BODY_MAX = 512 * 1024
export const MESSAGE_BYTES_MAX = 4 * 1024 * 1024

async function readCapped(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => {})
    throw new GoogleError("too_large", response.status)
  }
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw new GoogleError("too_large", response.status)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

const errorBody = z.looseObject({
  error: z
    .union([
      z.string(),
      z.looseObject({ errors: z.array(z.looseObject({ reason: z.string().optional() })).optional() }),
    ])
    .optional(),
})
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"])

/** Maps a failed response onto a kind. The body is read only for Google's own error codes and then dropped. */
function failure(response: Response, raw: string): GoogleError {
  let code: string | undefined
  let reasons: string[] = []
  try {
    const body = errorBody.parse(JSON.parse(raw))
    if (typeof body.error === "string") code = body.error
    else reasons = body.error?.errors?.map((e) => e.reason ?? "") ?? []
  } catch {}
  const retry = Number(response.headers.get("retry-after"))
  const retryAfterMs = Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) * 1000 : undefined
  const { status } = response
  if (status === 401 || code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client")
    return new GoogleError("auth", status)
  if (status === 429 || reasons.some((reason) => RATE_REASONS.has(reason)))
    return new GoogleError("rate", status, retryAfterMs)
  if (status === 403) return new GoogleError("scope", status)
  if (status >= 500) return new GoogleError("server", status, retryAfterMs)
  return new GoogleError("client", status)
}

async function call(runtime: GmailRuntime, url: string, init: RequestInit, max = SMALL_BODY_MAX): Promise<string> {
  let response: Response
  try {
    // `redirect: "error"`: an api answer never redirects, and a redirect must never be followed with a token attached.
    response = await runtime.fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new GoogleError("network")
  }
  let raw: string
  try {
    raw = await readCapped(response, response.ok ? max : SMALL_BODY_MAX)
  } catch (error) {
    if (error instanceof GoogleError) throw error
    throw new GoogleError("network", response.status)
  }
  if (!response.ok) throw failure(response, raw)
  return raw
}

const json = <T extends z.ZodType>(schema: T, raw: string): z.infer<T> => {
  try {
    return schema.parse(raw === "" ? {} : JSON.parse(raw))
  } catch {
    throw new GoogleError("client")
  }
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().default(3600),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
})
export type TokenResponse = z.infer<typeof tokenResponse>

const form = (values: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
})

export function authorizeUrl(runtime: GmailRuntime, params: { state: string; challenge: string }): string {
  const url = new URL(runtime.endpoints.authUrl)
  url.search = new URLSearchParams({
    client_id: runtime.clientId,
    redirect_uri: runtime.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
  }).toString()
  return url.href
}

export async function exchangeCode(runtime: GmailRuntime, code: string, verifier: string): Promise<TokenResponse> {
  const raw = await call(
    runtime,
    runtime.endpoints.tokenUrl,
    form({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: runtime.clientId,
      client_secret: runtime.clientSecret,
      redirect_uri: runtime.redirectUri,
    }),
  )
  return json(tokenResponse, raw)
}

export async function refreshAccessToken(runtime: GmailRuntime, refreshToken: string): Promise<TokenResponse> {
  const raw = await call(
    runtime,
    runtime.endpoints.tokenUrl,
    form({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: runtime.clientId,
      client_secret: runtime.clientSecret,
    }),
  )
  return json(tokenResponse, raw)
}

/** Best effort: a token Google already dropped is as good as revoked. */
export async function revokeToken(runtime: GmailRuntime, token: string): Promise<boolean> {
  try {
    await call(runtime, runtime.endpoints.revokeUrl, form({ token }))
    return true
  } catch (error) {
    return error instanceof GoogleError && error.kind === "auth"
  }
}

const label = z.object({ id: z.string().min(1), name: z.string() })
const profile = z.object({ emailAddress: z.string().min(3) })
const messageList = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).default([]),
  nextPageToken: z.string().optional(),
})

export interface MessagePart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: MessagePart[]
}
const part: z.ZodType<MessagePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z
      .object({ size: z.number().optional(), data: z.string().optional(), attachmentId: z.string().optional() })
      .optional(),
    parts: z.array(part).optional(),
  }),
)
const message = z.object({
  id: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
  sizeEstimate: z.number().optional(),
  payload: part.optional(),
})
export type GmailMessage = z.infer<typeof message>

/** The few Gmail calls skiffr makes, with one access token. */
export function gmail(runtime: GmailRuntime, accessToken: string) {
  const base = runtime.endpoints.gmailApi
  const request = (path: string, init: RequestInit = {}, max?: number) =>
    call(
      runtime,
      `${base}${path}`,
      { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${accessToken}` } },
      max,
    )
  const post = (body: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  return {
    async getProfile(): Promise<string> {
      return json(profile, await request("/users/me/profile")).emailAddress.toLowerCase()
    },
    async listLabels() {
      return json(z.object({ labels: z.array(label).default([]) }), await request("/users/me/labels")).labels
    },
    async createLabel(name: string) {
      return json(
        label,
        await request(
          "/users/me/labels",
          post({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
        ),
      )
    },
    async listMessages(query: string, pageToken: string | undefined, maxResults: number) {
      const params = new URLSearchParams({ q: query, maxResults: String(maxResults) })
      if (pageToken) params.set("pageToken", pageToken)
      return json(messageList, await request(`/users/me/messages?${params}`))
    },
    async getMessage(id: string) {
      return json(
        message,
        await request(`/users/me/messages/${encodeURIComponent(id)}?format=full`, {}, MESSAGE_BYTES_MAX),
      )
    },
    async modifyMessage(id: string, change: { add: string[]; remove: string[] }) {
      await request(
        `/users/me/messages/${encodeURIComponent(id)}/modify`,
        post({ addLabelIds: change.add, removeLabelIds: change.remove }),
      )
    },
  }
}
export type GmailApi = ReturnType<typeof gmail>

/** The `skiffr/jobs` label of the mailbox, created on first use. */
export async function ensureLabel(api: GmailApi, name: string): Promise<string> {
  const find = async () => (await api.listLabels()).find((label) => label.name === name)?.id
  const existing = await find()
  if (existing) return existing
  try {
    return (await api.createLabel(name)).id
  } catch (error) {
    // Two syncs creating it at once: the loser's create is refused, the label is there now.
    if (error instanceof GoogleError && error.kind === "client") {
      const raced = await find()
      if (raced) return raced
    }
    throw error
  }
}
