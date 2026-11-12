import { beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import type { Auth } from "@skiffr/auth"
import type { Db } from "@skiffr/db"
import { user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { strictDateSerializers } from "@skiffr/db/test-db"
import { createObservability, noopObservability, setObservability } from "@skiffr/observability"
import { mockCollector } from "@skiffr/observability/testing"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { createServer } from "./server"

const EXTENSION = `chrome-extension://${"a".repeat(32)}`
const COOKIE_SESSION = { user: { id: "ana", name: "Ana", email: "ana@test.dev" } }
const DRIZZLE = new URL("../../../packages/db/drizzle", import.meta.url).pathname

let server: (request: Request) => Promise<Response>

beforeAll(async () => {
  const db = drizzle(new PGlite({ extensions: { vector }, serializers: strictDateSerializers }), {
    schema,
  }) as unknown as Db
  await migrate(db as never, { migrationsFolder: DRIZZLE })
  const now = new Date()
  await db
    .insert(user)
    .values({ id: "ana", name: "Ana", email: "ana@test.dev", emailVerified: true, createdAt: now, updatedAt: now })
  // Only the cookie session is faked; it is what a request carrying a cookie resolves to.
  const auth = {
    handler: async () => new Response(null, { status: 204 }),
    api: { getSession: async ({ headers }: { headers: Headers }) => (headers.has("cookie") ? COOKIE_SESSION : null) },
  } as unknown as Auth
  server = createServer(
    {
      db,
      auth,
      now: () => new Date(),
      config: { deployEnv: "test", githubAuth: false },
      storage: null,
      model: null,
      embeddingModel: null,
    },
    { publicUrl: "http://api.test" },
  )
})

const rpc = (path: string, headers: Record<string, string>, body: unknown = {}) =>
  server(
    new Request(`http://api.test/rpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ json: body }),
    }),
  )

const session = { cookie: "session=1", "x-csrf-token": "orpc" }

test("a token calls the extension procedures over rpc without cookies or a csrf header, and not token management", async () => {
  const created = await (await rpc("tokens/create", session, { name: "laptop", expiresInDays: null })).json()
  const secret: string = created.json.secret
  const bearer = { authorization: `Bearer ${secret}`, origin: EXTENSION }

  const who = await rpc("extension/whoami", bearer, undefined)
  expect(who.status).toBe(200)
  expect(who.headers.get("access-control-allow-origin")).toBe(EXTENSION)
  expect((await who.json()).json.user.email).toBe("ana@test.dev")

  expect((await rpc("tokens/list", bearer)).status).toBe(403)
  expect((await rpc("me/get", bearer)).status).toBe(403)
  expect((await rpc("tokens/list", { origin: EXTENSION, cookie: "session=1", "x-csrf-token": "orpc" })).status).toBe(
    401,
  )
})

test("every rpc answer carries a request id for the log line of a failure", async () => {
  const [first, second] = await Promise.all([rpc("tokens/list", session), rpc("tokens/list", session)])
  expect(first.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
  expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"))
})

test("a bad token is a bare 401 even when a valid cookie rides along", async () => {
  const res = await rpc("extension/whoami", { authorization: "Bearer skp_nope", ...session })
  expect(res.status).toBe(401)
  expect((await res.json()).json.message).toBe("Unauthorized.")
})

test("the preflight from an extension allows its headers and never credentials", async () => {
  const res = await server(
    new Request("http://api.test/rpc/extension/whoami", {
      method: "OPTIONS",
      headers: {
        origin: EXTENSION,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,x-skiffr-client",
      },
    }),
  )
  expect(res.status).toBe(204)
  expect(res.headers.get("access-control-allow-origin")).toBe(EXTENSION)
  expect(res.headers.get("access-control-allow-headers")).toBe("authorization, content-type, x-skiffr-client")
  expect(res.headers.has("access-control-allow-credentials")).toBe(false)
})

test("other origins and other routes get no cors", async () => {
  const preflight = (origin: string, path: string) =>
    server(
      new Request(`http://api.test${path}`, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST" },
      }),
    )
  expect(
    (await preflight("https://evil.dev", "/rpc/extension/whoami")).headers.has("access-control-allow-origin"),
  ).toBe(false)
  expect((await preflight(EXTENSION, "/auth/sign-in/email")).headers.has("access-control-allow-origin")).toBe(false)
  expect(
    (await preflight("chrome-extension://short", "/rpc/extension/whoami")).headers.has("access-control-allow-origin"),
  ).toBe(false)
})

test("every /rpc and /v1 answer varies on Origin, other routes don't", async () => {
  const get = (path: string, headers: Record<string, string> = {}) =>
    server(new Request(`http://api.test${path}`, { headers }))
  expect((await get("/rpc/extension/whoami")).headers.get("vary")).toContain("Origin")
  expect((await get("/rpc/extension/whoami", { origin: "https://evil.dev" })).headers.get("vary")).toContain("Origin")
  expect((await get("/v1/extension/whoami", { origin: EXTENSION })).headers.get("vary")).toContain("Origin")
  expect((await get("/health")).headers.get("vary")).toBeNull()
})

test("numeric query parameters of GET routes arrive as strings and are still numbers", async () => {
  const get = (path: string) => server(new Request(`http://api.test${path}`, { headers: session }))
  for (const path of ["/v1/learning/sites?limit=5", "/v1/learning/stats?limit=5", "/v1/answers?limit=5&offset=0"]) {
    const res = await get(path)
    expect(res.status, path).toBe(200)
  }
  expect((await get("/v1/learning/sites?limit=0")).status).toBe(400)
})

test("a request is logged and counted by method, route and status, never by its query, body or cookie", async () => {
  const collector = mockCollector()
  const observability = createObservability({
    service: "skiffr-api",
    environment: "test",
    otlpEndpoint: `${collector.url}/api/default`,
    flushMs: 0,
  })
  setObservability(observability)
  try {
    await server(
      new Request("http://api.test/rpc/answers/list?email=jane@example.com", {
        method: "POST",
        headers: { cookie: "session=SECRET-COOKIE" },
        body: JSON.stringify({ value: "Jane Doe" }),
      }),
    )
    await server(new Request("http://api.test/files/resume-of-jane.pdf"))
    await server(new Request("http://api.test/some/junk/jane-doe"))
    await observability.flush()
    const sent = collector.everything()
    expect(sent).toContain("http.request")
    expect(sent).toContain("/files/:key")
    expect(sent).toContain('"stringValue":"other"')
    for (const leak of ["jane", "Jane", "SECRET-COOKIE", "email="]) expect(sent).not.toContain(leak)
  } finally {
    setObservability(noopObservability)
    collector.stop()
  }
})

test("a flood of urls with a typed segment can't add labels or hide the health gauge", async () => {
  const collector = mockCollector()
  const observability = createObservability({
    service: "skiffr-api",
    environment: "test",
    otlpEndpoint: `${collector.url}/api/default`,
    flushMs: 0,
  })
  setObservability(observability)
  try {
    for (let i = 0; i < 1500; i++)
      await server(new Request(`http://api.test/v1/answers/jane${i}`, { method: "PATCH", body: "{}" }))
    await server(new Request("http://api.test/v1/answers/3f2c9a10-1b2c-4d3e-8f90-123456789abc/use", { method: "POST" }))
    await server(new Request("http://api.test/rpc/answers/jane"))
    await server(new Request("http://api.test/health"))
    await observability.flush()
    const sent = collector.everything()
    expect(sent).not.toContain("jane")
    expect(sent).not.toContain("3f2c9a10")
    expect(sent).toContain("/v1/answers/:id")
    expect(sent).toContain("/v1/answers/:id/use")
    expect(sent).toContain("skiffr.db.up")
    const metrics = collector.requests.find((request) => request.path.endsWith("/metrics"))?.body ?? ""
    const series = JSON.parse(metrics).resourceMetrics[0].scopeMetrics[0].metrics.flatMap(
      (metric: { sum?: { dataPoints: unknown[] } }) => metric.sum?.dataPoints ?? [],
    )
    expect(series.length).toBeLessThan(20)
  } finally {
    setObservability(noopObservability)
    collector.stop()
  }
})
