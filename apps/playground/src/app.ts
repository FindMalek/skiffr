import { timingSafeEqual } from "node:crypto"
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
import { finalize, PAGE_HEADERS } from "./inject.ts"
import { inspectPage } from "./inspect.ts"
import { renderSite } from "./render.ts"
import { SITE_BY_ID } from "./sites.ts"
import { buildSubmission, parseSummaries, readPosted, SubmissionStore } from "./submissions.ts"
import { isVariant, readSwitches, VariantState } from "./switches.ts"

const MAX_BODY = 1_500_000

type Telemetry = Pick<ReturnType<typeof fromEnv>, "sendUmamiEvent" | "captureException">

export interface AppOptions {
  config?: Config
  store?: SubmissionStore
  variants?: VariantState
  telemetry?: Telemetry
}

export type Handler = (request: Request) => Promise<Response>

const JS = { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" }

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
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

  const allowed = (request: Request, url: URL, form?: FormData): boolean => {
    if (!config.token) return true
    const given =
      request.headers.get("x-playground-token") ??
      url.searchParams.get("token") ??
      (form?.get("token") as string | null) ??
      ""
    return safeEqual(given, config.token)
  }
  const denied = (): Response =>
    new Response("a token is needed", { status: 401, headers: { "content-type": "text/plain" } })

  async function submissions(request: Request, url: URL): Promise<Response> {
    if (request.method === "GET") {
      if (!allowed(request, url)) return denied()
      return jsonResponse({
        submissions: store.list({ run: url.searchParams.get("run") ?? "", site: url.searchParams.get("site") ?? "" }),
      })
    }
    if (request.method === "DELETE") {
      if (!allowed(request, url)) return denied()
      store.clear(url.searchParams.get("run") ?? undefined)
      return jsonResponse({ cleared: true })
    }
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 })
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return new Response("too large", { status: 413 })
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return new Response("unreadable form", { status: 400 })
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
    if (request.method === "GET") {
      if (!allowed(request, url)) return denied()
      return htmlResponse(adminPage(variants, { token: url.searchParams.get("token") ?? "", umami: config.umami }))
    }
    const form = await request.formData().catch(() => null)
    if (!form || !allowed(request, url, form)) return denied()
    const token =
      typeof form.get("token") === "string" ? `?token=${encodeURIComponent(form.get("token") as string)}` : ""
    if (url.pathname === "/admin/reset") variants.reset()
    else {
      const site = String(form.get("site") ?? "")
      const variant = String(form.get("variant") ?? "")
      if (!SITE_BY_ID.has(site) || (variant !== "none" && !isVariant(variant)))
        return new Response("unknown site or variant", { status: 400 })
      variants.set(site, isVariant(variant) ? variant : null)
    }
    return new Response(null, { status: 303, headers: { location: `/admin${token}` } })
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    try {
      if (pathname === "/health") return jsonResponse({ ok: true })
      if (pathname === "/pg.js") return new Response(await staticScript("pg.js"), { headers: JS })
      if (pathname === "/wizard.js") return new Response(await staticScript("wizard.js"), { headers: JS })
      if (pathname === "/shared/widgets.js") {
        return new Response(await readFile(join(config.fixturesDir, "shared", "widgets.js"), "utf8"), { headers: JS })
      }
      if (pathname.startsWith("/client/")) {
        const built = clientBundle(pathname.slice("/client/".length))
        return built ? new Response(await built, { headers: JS }) : notFound()
      }
      if (pathname === "/api/submissions") return await submissions(request, url)
      if (pathname === "/api/jobs") return jsonResponse({ jobs: jobLinks(config) })
      if (pathname === "/inspect") {
        if (!allowed(request, url)) return denied()
        const filter = { run: url.searchParams.get("run") ?? "", site: url.searchParams.get("site") ?? "" }
        const list = store.list(filter)
        const only = url.searchParams.get("id")
        return htmlResponse(
          inspectPage(only ? list.filter((item) => item.id === only) : list, filter, {
            token: url.searchParams.get("token") ?? "",
            umami: config.umami,
          }),
        )
      }
      if (pathname === "/admin" || pathname.startsWith("/admin/")) return await admin(request, url)

      const { route, path } = routeFor(config, request.headers.get("host"), pathname)
      if (route.kind === "index") return pathname === "/" ? htmlResponse(indexPage(config)) : notFound()
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("method not allowed", { status: 405 })
      void path
      const switches = readSwitches(url.searchParams, variants.get(route.site.id))
      const origin = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`)
      const rendered = await renderSite({ config, site: route.site, switches, origin, viaPath: route.viaPath })
      if (!rendered) return notFound()
      return htmlResponse(
        finalize(rendered.html, { site: route.site, switches, hasJob: rendered.hasJob }),
        200,
        PAGE_HEADERS,
      )
    } catch (error) {
      void telemetry.captureException(error, { pathname })
      return new Response("server error", { status: 500, headers: { "content-type": "text/plain" } })
    }
  }

  return { handle, store, variants }
}
