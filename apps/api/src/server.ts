import { OpenAPIHandler } from "@orpc/openapi/fetch"
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins"
import { RPCHandler } from "@orpc/server/fetch"
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins"
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4"
import { type Auth, CLIENT_IP_HEADER, UNKNOWN_CLIENT_IP } from "@skiffr/auth"
import { getObservability } from "@skiffr/observability"
import { appRouter, bearerSecret, createContext, type Services } from "@skiffr/orpc"
import { sql } from "drizzle-orm"
import { type ClientIpConfig, clientIpOf } from "./client-ip"
import { type Handler, withExtensionCors } from "./cors"
import { GMAIL_ROUTES, handleGmail } from "./gmail"
import { withSecurityHeaders } from "./headers"
import { recordRequest } from "./telemetry"
import { VERSION } from "./version"

export type { Handler } from "./cors"

const DEFAULT_CLIENT_IP: ClientIpConfig = { header: "x-forwarded-for", trustedProxies: 1 }

/** A rate limited answer carries its wait in `data.retryAfterSeconds`; plain http clients look in `Retry-After`. */
async function retryAfterOf(response: Response): Promise<string | null> {
  if (response.status !== 429 || response.headers.has("retry-after")) return null
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as {
    json?: { data?: { retryAfterSeconds?: unknown } }
    data?: { retryAfterSeconds?: unknown }
  } | null
  const seconds = body?.json?.data?.retryAfterSeconds ?? body?.data?.retryAfterSeconds
  return typeof seconds === "number" && Number.isFinite(seconds) ? String(Math.max(1, Math.ceil(seconds))) : null
}

async function withRequestId(response: Response, requestId: string): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.set("x-request-id", requestId)
  const wait = await retryAfterOf(response)
  if (wait) headers.set("retry-after", wait)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

type Interceptors = NonNullable<NonNullable<ConstructorParameters<typeof RPCHandler>[1]>["interceptors"]>

/**
 * The api is the only app that touches the database, auth, storage and providers. Routes:
 *   /auth/*       better-auth (sign-in posts are rate limited per ip; the dashboard proxies /api/auth/* here, so cookies stay first-party)
 *   /rpc/*        oRPC for web + dashboard (cookie sessions need `x-csrf-token: orpc`) and the extension (bearer token, CORS for its origin)
 *   /v1/*         the same procedures as REST, docs at /v1/docs, spec at /v1/openapi.json
 *   /files/<key>  redirect to a short-lived url for an uploaded file
 *   /gmail/connect, /gmail/callback  the Google consent for the Gmail job import (cookie session only, reached through the dashboard proxy)
 *   /telegram/webhook  Telegram bot updates (secret header checked)
 *   /health       for Dokploy and uptime checks
 *   /version      release version and commit of this build, plus an update hint when UPDATE_CHECK is on
 *   /downloads    the extension zip that matches this build
 */
export function createServer(
  services: Services & { auth: Auth },
  opts: {
    publicUrl: string
    dashboardUrl?: string
    extensionOrigins?: string[]
    clientIp?: ClientIpConfig
    version?: () => Promise<Record<string, unknown>>
    downloads?: (pathname: string) => Promise<Response | null>
  },
) {
  const clientIp = opts.clientIp ?? DEFAULT_CLIENT_IP
  const peers = new WeakMap<Request, string>()
  let warned = false
  const interceptors: Interceptors = []
  const wrappers: Array<(next: Handler) => Handler> = []
  const rpc = new RPCHandler(appRouter, { plugins: [new SimpleCsrfProtectionHandlerPlugin()], interceptors })
  const rpcBearer = new RPCHandler(appRouter, { interceptors })
  const rest = new OpenAPIHandler(appRouter, {
    interceptors,
    plugins: [
      new OpenAPIReferencePlugin({
        docsPath: "/docs",
        specPath: "/openapi.json",
        docsTitle: "Skiffr API",
        schemaConverters: [new ZodToJsonSchemaConverter()],
        specGenerateOptions: {
          info: { title: "Skiffr API", version: VERSION },
          servers: [{ url: `${opts.publicUrl}/v1` }],
        },
      }),
    ],
  })

  async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === "/" || pathname === "/docs") return Response.redirect(new URL("/v1/docs", request.url), 302)
    if (pathname.startsWith("/auth/")) {
      // The proxy strips the app's `/api` prefix; better-auth expects its default `/api/auth` base path back.
      const url = new URL(request.url)
      url.pathname = `/api${pathname}`
      const forwarded = new Request(url, request)
      // Always set here and never taken from the client: it is the one header better-auth reads the address from
      const ip = clientIpOf(request.headers, clientIp, peers.get(request))
      if (!ip && !warned) {
        warned = true
        console.warn(
          `[auth] no client address from ${clientIp.header} or the connection: those requests share one sign-in bucket. Check CLIENT_IP_HEADER and TRUSTED_PROXY_COUNT`,
        )
      }
      forwarded.headers.set(CLIENT_IP_HEADER, ip ?? UNKNOWN_CLIENT_IP)
      return services.auth.handler(forwarded)
    }
    if (GMAIL_ROUTES.has(pathname)) return handleGmail(request, services, opts.dashboardUrl)
    if (pathname === "/health") {
      const db = await services.db
        .execute(sql`select 1`)
        .then(() => true)
        .catch(() => false)
      getObservability().gauge("skiffr.db.up", db ? 1 : 0)
      return Response.json({ ok: db, db, env: services.config.deployEnv }, { status: db ? 200 : 503 })
    }
    if (pathname === "/version" && opts.version) {
      return Response.json(await opts.version(), { headers: { "cache-control": "no-store" } })
    }
    const download = await opts.downloads?.(pathname)
    if (download) return download
    if (pathname.startsWith("/files/")) {
      if (!services.storage) return Response.json({ message: "Storage is not configured." }, { status: 404 })
      const location = services.storage.url(decodeURIComponent(pathname.slice("/files/".length)))
      return new Response(null, { status: 302, headers: { location, "cache-control": "public, max-age=3000" } })
    }

    const requestId = crypto.randomUUID()
    const context = await createContext(services, request.headers, requestId)
    const viaRpc = await (bearerSecret(request.headers) === null ? rpc : rpcBearer).handle(request, {
      prefix: "/rpc",
      context,
    })
    if (viaRpc.matched) return await withRequestId(viaRpc.response, requestId)
    const viaRest = await rest.handle(request, { prefix: "/v1", context })
    if (viaRest.matched) return await withRequestId(viaRest.response, requestId)
    return Response.json({ message: "Not found." }, { status: 404 })
  }

  const https = opts.publicUrl.startsWith("https://")
  const handler = withExtensionCors(
    wrappers.reduceRight<Handler>((next, wrap) => wrap(next), handle),
    opts.extensionOrigins,
  )
  return async function fetch(request: Request, peer?: string): Promise<Response> {
    if (peer) peers.set(request, peer)
    const startedAt = performance.now()
    const response = withSecurityHeaders(await handler(request), { https })
    recordRequest(request, response, startedAt)
    return response
  }
}
