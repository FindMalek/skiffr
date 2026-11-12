import { beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { createAuth } from "@skiffr/auth"
import { type Db, rateLimit } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { strictDateSerializers } from "@skiffr/db/test-db"
import { RateLimiter } from "@skiffr/orpc"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { createServer } from "./server"

const DASHBOARD = "http://localhost:3002"
const DRIZZLE = new URL("../../../packages/db/drizzle", import.meta.url).pathname

let db: Db
let server: (request: Request) => Promise<Response>

beforeAll(async () => {
  db = drizzle(new PGlite({ extensions: { vector }, serializers: strictDateSerializers }), { schema }) as unknown as Db
  await migrate(db as never, { migrationsFolder: DRIZZLE })
  const auth = createAuth({
    db,
    secret: "x".repeat(40),
    dashboardUrl: DASHBOARD,
    trustedOrigins: [DASHBOARD],
    secureCookies: false,
    rateLimit: true,
  })
  server = createServer(
    {
      db,
      auth,
      now: () => new Date(),
      config: { deployEnv: "test", githubAuth: false },
      storage: null,
      model: null,
      embeddingModel: null,
      limits: new RateLimiter({
        read: { burst: 2, perMinute: 60 },
        write: { burst: 2, perMinute: 60 },
        ai: { burst: 1, perMinute: 60 },
        expensive: { burst: 1, perMinute: 60 },
      }),
    },
    { publicUrl: "http://api.test", dashboardUrl: DASHBOARD },
  )
})

const post = (path: string, body: unknown, ip: string, headers: Record<string, string> = {}) =>
  server(
    new Request(`http://api.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: DASHBOARD, "x-forwarded-for": ip, ...headers },
      body: JSON.stringify(body),
    }),
  )

test("sign-in attempts are limited per ip in the database, and another ip is not affected", async () => {
  const attempt = (ip: string) =>
    post("/auth/sign-in/email", { email: "nobody@test.dev", password: "wrong-password" }, ip)
  const statuses: number[] = []
  for (let i = 0; i < 11; i++) statuses.push((await attempt("203.0.113.7")).status)
  expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true)
  expect(statuses[10]).toBe(429)
  expect((await attempt("203.0.113.8")).status).not.toBe(429)
  expect((await db.select().from(rateLimit)).length).toBeGreaterThan(0)
})

test("a signed-in user gets a 429 with a wait time from the rpc once the bucket is empty", async () => {
  const signUp = await post(
    "/auth/sign-up/email",
    { email: "ana@test.dev", name: "Ana", password: "a-long-enough-password" },
    "198.51.100.1",
  )
  expect(signUp.status).toBe(200)
  const cookie = (signUp.headers.getSetCookie() as string[]).map((value) => value.split(";")[0]).join("; ")
  const read = () => post("/rpc/profile/get", {}, "198.51.100.1", { cookie, "x-csrf-token": "orpc" })

  expect((await read()).status).toBe(200)
  expect((await read()).status).toBe(200)
  const limited = await read()
  expect(limited.status).toBe(429)
  const body = await limited.json()
  expect(body.json).toMatchObject({ code: "TOO_MANY_REQUESTS", status: 429, data: { retryAfterSeconds: 1 } })
})
