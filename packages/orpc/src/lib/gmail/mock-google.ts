import { createHash, randomBytes } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { GoogleEndpoints } from "./google"

/**
 * A local stand-in for the parts of Google that skiffr talks to: the OAuth consent, token and revoke endpoints and the
 * Gmail REST calls `users.getProfile`, `users.labels.list/create` and `users.messages.list/get/modify`. It is for tests and
 * the local harness only. It keeps one mailbox in memory and can be told to fail the next calls.
 */
export interface MockMessage {
  id: string
  from: string
  html?: string
  text?: string
  unread?: boolean
  inbox?: boolean
  /** Gmail's `Authentication-Results`; by default a dmarc pass for the sender's domain, `null` leaves the header out. */
  authentication?: string | null
  /** Extra attachment parts (name only): they carry data the parser must never open. */
  attachment?: string
  /** Pad the html part with this many extra characters. */
  padding?: number
}

interface StoredMessage extends MockMessage {
  labelIds: Set<string>
  order: number
}

export interface Fault {
  match: RegExp
  status: number
  body?: unknown
  headers?: Record<string, string>
  /** How many requests it fails; default 1. */
  times?: number
}

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64url")

export interface MockGoogle {
  url: string
  endpoints: GoogleEndpoints
  mailbox: { email: string }
  /** Messages by id, with their current labels. */
  messages: Map<string, StoredMessage>
  labels: Map<string, string>
  requests: { method: string; path: string; authorization: string | null }[]
  /** Refresh tokens Google would still accept. */
  refreshTokens: Set<string>
  revoked: string[]
  /** Next consent: the user presses cancel. */
  denyConsent: boolean
  /** Next token exchange leaves out the refresh token, or grants a narrower scope. */
  omitRefreshToken: boolean
  grantedScope: string | null
  add(message: MockMessage): void
  fail(fault: Fault): void
  clearFaults(): void
  /** Makes the next consent authorize `email`. */
  setEmail(email: string): void
  close(): Promise<void>
}

function matches(message: StoredMessage, query: string): boolean {
  const from = /from:\(([^)]*)\)/.exec(query)?.[1]?.split(/\s+OR\s+/) ?? []
  if (/\bis:unread\b/.test(query) && !message.labelIds.has("UNREAD")) return false
  if (/\bin:inbox\b/.test(query) && !message.labelIds.has("INBOX")) return false
  // Like Gmail, `from:` also matches the display name, not only the address.
  if (from.length > 0 && !from.some((term) => message.from.toLowerCase().includes(term.toLowerCase()))) return false
  return true
}

function payload(message: StoredMessage) {
  const parts: object[] = []
  if (message.text !== undefined) {
    parts.push({
      mimeType: "text/plain",
      filename: "",
      headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }],
      body: { size: message.text.length, data: b64(message.text) },
    })
  }
  if (message.html !== undefined) {
    const html = message.html + (message.padding ? `<!--${"x".repeat(message.padding)}-->` : "")
    parts.push({
      mimeType: "text/html",
      filename: "",
      headers: [{ name: "Content-Type", value: 'text/html; charset="UTF-8"' }],
      body: { size: html.length, data: b64(html) },
    })
  }
  if (message.attachment) {
    parts.push({ mimeType: "application/pdf", filename: message.attachment, body: { size: 10, attachmentId: "att-1" } })
  }
  const domain = message.from.match(/@([^>\s]+)>?\s*$/)?.[1]
  const authentication =
    message.authentication === undefined && domain
      ? `mx.google.com; dkim=pass header.d=${domain}; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=${domain}`
      : message.authentication
  const headers = [
    { name: "From", value: message.from },
    { name: "Subject", value: "Job alert" },
    ...(authentication ? [{ name: "Authentication-Results", value: authentication }] : []),
  ]
  return { mimeType: "multipart/mixed", headers, body: { size: 0 }, parts }
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

export async function startMockGoogle(): Promise<MockGoogle> {
  const codes = new Map<string, { challenge: string; token: string }>()
  const accessTokens = new Set<string>()
  const faults: Fault[] = []
  let counter = 0
  const mock = {
    messages: new Map<string, StoredMessage>(),
    labels: new Map<string, string>(),
    requests: [] as MockGoogle["requests"],
    refreshTokens: new Set<string>(),
    revoked: [] as string[],
    denyConsent: false,
    omitRefreshToken: false,
    grantedScope: null as string | null,
    mailbox: { email: "ana.inbox@example.test" },
  }

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://mock")
    const path = url.pathname
    const authorization = request.headers.authorization ?? null
    mock.requests.push({ method: request.method ?? "GET", path, authorization })
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers })
      response.end(JSON.stringify(body))
    }

    const faultAt = faults.findIndex((fault) => fault.match.test(`${request.method} ${path}`))
    if (faultAt >= 0) {
      const fault = faults[faultAt]!
      fault.times = (fault.times ?? 1) - 1
      if (fault.times <= 0) faults.splice(faultAt, 1)
      return send(fault.status, fault.body ?? { error: { code: fault.status, errors: [] } }, fault.headers)
    }

    if (path === "/auth") {
      const redirect = url.searchParams.get("redirect_uri")
      if (!redirect) return send(400, { error: "invalid_request" })
      const target = new URL(redirect)
      target.searchParams.set("state", url.searchParams.get("state") ?? "")
      if (mock.denyConsent) target.searchParams.set("error", "access_denied")
      else {
        const code = `code-${++counter}-${randomBytes(4).toString("hex")}`
        const token = `rt-${++counter}-${randomBytes(6).toString("hex")}`
        codes.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", token })
        target.searchParams.set("code", code)
      }
      response.writeHead(302, { location: target.href })
      return response.end()
    }

    if (path === "/token") {
      const form = new URLSearchParams(await readBody(request))
      if (form.get("grant_type") === "authorization_code") {
        const issued = codes.get(form.get("code") ?? "")
        const verifier = form.get("code_verifier") ?? ""
        codes.delete(form.get("code") ?? "")
        if (!issued || createHash("sha256").update(verifier).digest("base64url") !== issued.challenge) {
          return send(400, { error: "invalid_grant" })
        }
        const access = `at-${++counter}`
        accessTokens.add(access)
        if (!mock.omitRefreshToken) mock.refreshTokens.add(issued.token)
        return send(200, {
          access_token: access,
          expires_in: 3599,
          token_type: "Bearer",
          scope: mock.grantedScope ?? "https://www.googleapis.com/auth/gmail.modify",
          ...(mock.omitRefreshToken ? {} : { refresh_token: issued.token }),
        })
      }
      if (form.get("grant_type") === "refresh_token") {
        if (!mock.refreshTokens.has(form.get("refresh_token") ?? "")) return send(400, { error: "invalid_grant" })
        const access = `at-${++counter}`
        accessTokens.add(access)
        return send(200, { access_token: access, expires_in: 3599, token_type: "Bearer" })
      }
      return send(400, { error: "unsupported_grant_type" })
    }

    if (path === "/revoke") {
      const token = new URLSearchParams(await readBody(request)).get("token") ?? ""
      mock.revoked.push(token)
      mock.refreshTokens.delete(token)
      accessTokens.delete(token)
      return send(200, {})
    }

    if (path.startsWith("/gmail/v1/")) {
      const bearer = authorization?.replace(/^Bearer /, "")
      if (!bearer || !accessTokens.has(bearer)) {
        return send(401, { error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } })
      }
      const rest = path.slice("/gmail/v1/users/me".length)
      if (rest === "/profile") return send(200, { emailAddress: mock.mailbox.email, messagesTotal: mock.messages.size })
      if (rest === "/labels" && request.method === "GET") {
        return send(200, { labels: [...mock.labels].map(([id, name]) => ({ id, name })) })
      }
      if (rest === "/labels" && request.method === "POST") {
        const { name } = JSON.parse(await readBody(request)) as { name: string }
        if ([...mock.labels.values()].includes(name))
          return send(409, { error: { code: 409, message: "Label name exists" } })
        const id = `Label_${mock.labels.size + 1}`
        mock.labels.set(id, name)
        return send(200, { id, name })
      }
      if (rest === "/messages" && request.method === "GET") {
        const query = url.searchParams.get("q") ?? ""
        const size = Number(url.searchParams.get("maxResults") ?? 100)
        const offset = Number(url.searchParams.get("pageToken") ?? 0)
        const hits = [...mock.messages.values()]
          .filter((message) => matches(message, query))
          .sort((a, b) => b.order - a.order)
        const page = hits.slice(offset, offset + size)
        const next = offset + size < hits.length ? String(offset + size) : undefined
        return send(200, {
          messages: page.map((message) => ({ id: message.id, threadId: message.id })),
          nextPageToken: next,
        })
      }
      const one = /^\/messages\/([^/]+)(\/modify)?$/.exec(rest)
      if (one) {
        const message = mock.messages.get(decodeURIComponent(one[1]!))
        if (!message) return send(404, { error: { code: 404, message: "Requested entity was not found." } })
        if (one[2]) {
          const change = JSON.parse(await readBody(request)) as { addLabelIds?: string[]; removeLabelIds?: string[] }
          for (const id of change.addLabelIds ?? []) {
            if (!mock.labels.has(id) && !["UNREAD", "INBOX"].includes(id))
              return send(400, { error: { code: 400, message: "Invalid label" } })
            message.labelIds.add(id)
          }
          for (const id of change.removeLabelIds ?? []) message.labelIds.delete(id)
          return send(200, { id: message.id, labelIds: [...message.labelIds] })
        }
        return send(200, {
          id: message.id,
          labelIds: [...message.labelIds],
          sizeEstimate: 1000,
          payload: payload(message),
        })
      }
    }
    return send(404, { error: { code: 404, message: "no such route" } })
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  let order = 0

  return {
    ...mock,
    url,
    endpoints: {
      authUrl: `${url}/auth`,
      tokenUrl: `${url}/token`,
      revokeUrl: `${url}/revoke`,
      gmailApi: `${url}/gmail/v1`,
    },
    add(message) {
      const labelIds = new Set<string>()
      if (message.unread !== false) labelIds.add("UNREAD")
      if (message.inbox !== false) labelIds.add("INBOX")
      mock.messages.set(message.id, { ...message, labelIds, order: ++order })
    },
    fail: (fault) => void faults.push({ ...fault }),
    clearFaults: () => void faults.splice(0),
    setEmail(email) {
      mock.mailbox.email = email
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
    get denyConsent() {
      return mock.denyConsent
    },
    set denyConsent(value: boolean) {
      mock.denyConsent = value
    },
    get omitRefreshToken() {
      return mock.omitRefreshToken
    },
    set omitRefreshToken(value: boolean) {
      mock.omitRefreshToken = value
    },
    get grantedScope() {
      return mock.grantedScope
    },
    set grantedScope(value: string | null) {
      mock.grantedScope = value
    },
  }
}
