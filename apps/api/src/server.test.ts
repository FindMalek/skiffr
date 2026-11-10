import { beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import type { Auth } from "@skiffr/auth"
import type { Db } from "@skiffr/db"
import { user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { createServer } from "./server"

const EXTENSION = `chrome-extension://${"a".repeat(32)}`
const COOKIE_SESSION = { user: { id: "ana", name: "Ana", email: "ana@test.dev" } }
const DRIZZLE = new URL("../../../packages/db/drizzle", import.meta.url).pathname

let server: (request: Request) => Promise<Response>

beforeAll(async () => {
  const db = drizzle(new PGlite({ extensions: { vector } }), { schema }) as unknown as Db
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
    { db, auth, now: () => new Date(), config: { deployEnv: "test", githubAuth: false }, storage: null, model: null },
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
        "access-control-request-headers": "authorization,content-type",
      },
    }),
  )
  expect(res.status).toBe(204)
  expect(res.headers.get("access-control-allow-origin")).toBe(EXTENSION)
  expect(res.headers.get("access-control-allow-headers")).toBe("authorization, content-type")
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
