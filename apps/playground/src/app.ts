import { randomUUID, timingSafeEqual } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fromEnv } from "@skiffr/telemetry"
import { adminPage } from "./admin.ts"
import { clientBundle, staticScript } from "./bundle.ts"
import { type Config, readConfig } from "./config.ts"
import { confirmationPage } from "./confirm.ts"
import { jobLinks, routeFor } from "./hosts.ts"
import { htmlResponse, jsonResponse, notFound } from "./html.ts"
import { indexPage } from "./index-page.ts"
import { finalize } from "./inject.ts"
import { inspectPage } from "./inspect.ts"
import { RateLimiter } from "./rate-limit.ts"
import { renderSite } from "./render.ts"
import { BASE_HEADERS, pageCsp, ROBOTS, staticCsp } from "./security.ts"
import { SITE_BY_ID } from "./sites.ts"
import { buildSubmission, parseSummaries, readPosted, SubmissionStore } from "./submissions.ts"
import { isVariant, readSwitches, VariantState } from "./switches.ts"

type Telemetry = Pick<ReturnType<typeof fromEnv>, "sendUmamiEvent" | "captureException">

export interface AppOptions {
  config?: Config
  store?: SubmissionStore
  variants?: VariantState
  telemetry?: Telemetry
  limiter?: RateLimiter
}

/** What the server layer knows about the caller and the request cannot say. */
export interface RequestMeta {
  ip: string | null
}

export type Handler = (request: Request, meta?: RequestMeta) => Promise<Response>

const JS = { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" }
const COOKIE = "pg_token"
/** A run id this long cannot be guessed: it is the capability to read, and to forget, that run's submissions. */
const CAPABILITY_MIN = 16
const COOKIE_MAX_AGE = 8 * 3600

const text = (status: number, body: string, extra: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...extra } })

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function cookieValue(request: Request, name: string): string {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="))
      } catch {
        return ""
      }
    }
  }
  return ""
}

/**
 * A form post from another site carries `Sec-Fetch-Site: cross-site` and its own Origin: it never reaches the admin
 * actions. `Sec-Fetch-Site` is the one to trust when a browser sends it: with `Referrer-Policy: no-referrer` a same
 * origin post carries `Origin: null`, so the Origin alone cannot tell it from an attack.
 */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site")
  if (site) return site === "same-origin"
  const origin = request.headers.get("origin")
  if (!origin) return true
  try {
    return new URL(origin).host === request.headers.get("host")
  } catch {
    return false
  }
}

export function createApp(options: AppOptions = {}): {
  handle: Handler
  store: SubmissionStore
  variants: VariantState
} {
  const config = options.config ?? readConfig()
  const store = options.store ?? new SubmissionStore(config.maxSubmissions)
  const variants = options.variants ?? new VariantState()
  const telemetry = options.telemetry ?? fromEnv(process.env)
  const limiter = options.limiter ?? new RateLimiter(config.rateBurst, config.ratePerMinute)

  /** ok: go on. A token is needed when one is set, and always on a production or public host: without one those routes stay shut. */
  function access(request: Request, url: URL, form?: FormData): "ok" | "denied" | "locked" {
    if (!config.token) return config.locked ? "locked" : "ok"
    const given =
      request.headers.get("x-playground-token") ??
      (cookieValue(request, COOKIE) || (url.searchParams.get("token") ?? (form?.get("token") as string | null) ?? ""))
    return safeEqual(given, config.token) ? "ok" : "denied"
  }
  const refused = (state: "denied" | "locked"): Response =>
    state === "locked"
      ? text(403, "off until PLAYGROUND_TOKEN is set on this server")
      : text(401, "a token is needed", { "www-authenticate": 'Token realm="playground"' })
  const capability = (url: URL): boolean => (url.searchParams.get("run") ?? "").length >= CAPABILITY_MIN

  const tooMany = (): Response => text(429, "slow down", { "retry-after": "10" })

  /** The token in a url goes into history and logs: swap it for a cookie on the first visit and drop it from the address. */
  function exchangeToken(request: Request, url: URL): Response | null {
    const given = url.searchParams.get("token")
    if (!given || !config.token || request.method !== "GET" || !safeEqual(given, config.token)) return null
    url.searchParams.delete("token")
    const secure = config.publicUrl.protocol === "https:" ? "; Secure" : ""
    return new Response(null, {
      status: 303,
      headers: {
        location: `${url.pathname}${url.search}`,
        "set-cookie": `${COOKIE}=${encodeURIComponent(config.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`,
      },
    })
  }

  async function submissions(request: Request, url: URL): Promise<Response> {
    if (request.method === "GET" || request.method === "DELETE") {
      const state = access(request, url)
      if (state !== "ok" && !capability(url)) return refused(state)
      const run = url.searchParams.get("run") ?? ""
      if (request.method === "GET") {
        return jsonResponse({ submissions: store.list({ run, site: url.searchParams.get("site") ?? "" }) })
      }
      if (state !== "ok" && !run) return refused(state)
      store.clear(run || undefined)
      return jsonResponse({ cleared: true })
    }
    if (request.method !== "POST") return text(405, "method not allowed")
    if (Number(request.headers.get("content-length") ?? 0) > config.maxBody) return text(413, "too large")
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return text(400, "unreadable form")
    }
    const switches = readSwitches(url.searchParams)
    const siteParam = url.searchParams.get("site") ?? ""
    const { posted, summary } = await readPosted(form)
    const submission = buildSubmission(
      {
        site: SITE_BY_ID.has(siteParam) ? siteParam : "unknown",
        run: switches.run,
        variant: switches.variant,
        layout: switches.layout,
        cookie: switches.cookie,
        latency: switches.latency,
        host: request.headers.get("host") ?? "",
      },
      parseSummaries(summary),
      posted,
    )
    store.add(submission)
    void telemetry.sendUmamiEvent({
      name: "playground-submission",
      url: "/api/submissions",
      data: {
        site: submission.site,
        guardFailed: submission.counts.sensitiveTouched + submission.counts.trapTouched > 0,
      },
    })
    if ((request.headers.get("accept") ?? "").includes("application/json")) {
      return jsonResponse({ id: submission.id, counts: submission.counts })
    }
    return htmlResponse(confirmationPage(submission))
  }

  async function admin(request: Request, url: URL): Promise<Response> {
    const swapped = exchangeToken(request, url)
    if (swapped) return swapped
    if (request.method === "GET") {
      const state = access(request, url)
      return state === "ok" ? htmlResponse(adminPage(variants, { umami: config.umami })) : refused(state)
    }
    if (request.method !== "POST") return text(405, "method not allowed")
    if (!sameOrigin(request)) return text(403, "cross site request refused")
    const form = await request.formData().catch(() => null)
    const state = access(request, url, form ?? undefined)
    if (state !== "ok") return refused(state)
    if (!form) return text(400, "unreadable form")
    if (url.pathname === "/admin/reset") variants.reset()
    else {
      const site = String(form.get("site") ?? "")
      const variant = String(form.get("variant") ?? "")
      if (!SITE_BY_ID.has(site) || (variant !== "none" && !isVariant(variant)))
        return text(400, "unknown site or variant")
      variants.set(site, isVariant(variant) ? variant : null)
    }
    return new Response(null, { status: 303, headers: { location: "/admin" } })
  }

  function inspect(request: Request, url: URL): Response {
    const swapped = exchangeToken(request, url)
    if (swapped) return swapped
    const state = access(request, url)
    if (state !== "ok" && !capability(url)) return refused(state)
    const filter = { run: url.searchParams.get("run") ?? "", site: url.searchParams.get("site") ?? "" }
    const list = store.list(filter)
    const only = url.searchParams.get("id")
    return htmlResponse(
      inspectPage(only ? list.filter((item) => item.id === only) : list, filter, { umami: config.umami }),
    )
  }

  /** Reads and writes of data that is not the visitor's own are limited per address. */
  const limited = (pathname: string): boolean =>
    pathname === "/inspect" ||
    pathname === "/api/submissions" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")

  async function route(request: Request, meta: RequestMeta, url: URL): Promise<Response> {
    const { pathname } = url
    if (pathname === "/health") return jsonResponse({ ok: true })
    if (pathname === "/robots.txt") return text(200, ROBOTS)
    if (pathname === "/pg.js") return new Response(await staticScript("pg.js"), { headers: JS })
    if (pathname === "/wizard.js") return new Response(await staticScript("wizard.js"), { headers: JS })
    if (pathname === "/shared/widgets.js") {
      return new Response(await readFile(join(config.fixturesDir, "shared", "widgets.js"), "utf8"), { headers: JS })
    }
    if (pathname.startsWith("/client/")) {
      const built = clientBundle(pathname.slice("/client/".length))
      return built ? new Response(await built, { headers: JS }) : notFound()
    }
    if (limited(pathname) && !limiter.take(meta.ip ?? "unknown")) return tooMany()
    if (pathname === "/api/submissions") return await submissions(request, url)
    if (pathname === "/api/jobs") return jsonResponse({ jobs: jobLinks(config) })
    if (pathname === "/inspect") return inspect(request, url)
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return await admin(request, url)

    const { route: target } = routeFor(config, request.headers.get("host"), pathname)
    if (target.kind === "index") return pathname === "/" ? htmlResponse(indexPage(config)) : notFound()
    if (request.method !== "GET" && request.method !== "HEAD") return text(405, "method not allowed")
    const asked = readSwitches(url.searchParams, variants.get(target.site.id))
    // a page without a run gets its own unguessable one, so what a visitor submits can be read back by that visitor alone
    const switches = asked.run ? asked : { ...asked, run: randomUUID().replaceAll("-", "") }
    const origin = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`)
    const rendered = await renderSite({ config, site: target.site, switches, origin, viaPath: target.viaPath })
    if (!rendered) return notFound()
    const port = origin.port ? `:${origin.port}` : ""
    const parents =
      target.site.id === "embed-frame"
        ? [`${origin.protocol}//www.acme.test${port}`, `${origin.protocol}//embed.${config.publicUrl.hostname}${port}`]
        : []
    return htmlResponse(finalize(rendered.html, { site: target.site, switches, hasJob: rendered.hasJob }), 200, {
      "content-security-policy": pageCsp(parents),
    })
  }

  async function handle(request: Request, meta: RequestMeta = { ip: null }): Promise<Response> {
    const url = new URL(request.url)
    let response: Response
    try {
      response = await route(request, meta, url)
    } catch (error) {
      void telemetry.captureException(error, { pathname: url.pathname })
      response = text(500, "server error")
    }
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(BASE_HEADERS)) headers.set(name, value)
    if (!headers.has("content-security-policy") && (headers.get("content-type") ?? "").startsWith("text/html")) {
      headers.set("content-security-policy", staticCsp(config))
    }
    return new Response(response.body, { status: response.status, headers })
  }

  return { handle, store, variants }
}
