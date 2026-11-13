import { beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { createAuth, UNKNOWN_CLIENT_IP } from "@skiffr/auth"
import { type Db, rateLimit } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { strictDateSerializers } from "@skiffr/db/test-db"
import { RateLimiter } from "@skiffr/orpc"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { ClientIpConfig } from "./client-ip"
import { pruneRateLimits } from "./prune"
import { createServer } from "./server"

const DASHBOARD = "http://localhost:3002"
const DRIZZLE = new URL("../../../packages/db/drizzle", import.meta.url).pathname

let db: Db
let auth: ReturnType<typeof createAuth>
type Server = (request: Request, peer?: string) => Promise<Response>

beforeAll(async () => {
  db = drizzle(new PGlite({ extensions: { vector }, serializers: strictDateSerializers }), { schema }) as unknown as Db
  await migrate(db as never, { migrationsFolder: DRIZZLE })
  auth = createAuth({
    db,
    secret: "x".repeat(40),
    dashboardUrl: DASHBOARD,
    trustedOrigins: [DASHBOARD],
    secureCookies: false,
    rateLimit: true,
  })
})

const build = (clientIp?: ClientIpConfig): Server =>
  createServer(
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
        embed: { burst: 2, perMinute: 60 },
        upload: { burst: 1, perMinute: 60 },
        ai: { burst: 1, perMinute: 60 },
        expensive: { burst: 1, perMinute: 60 },
        sensitive: { burst: 1, perMinute: 60 },
      }),
    },
    { publicUrl: "http://api.test", dashboardUrl: DASHBOARD, clientIp },
  )

const post = (
  server: Server,
  path: string,
  body: unknown,
  forwarded: string | null,
  extra: { peer?: string; headers?: Record<string, string> } = {},
) =>
  server(
    new Request(`http://api.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: DASHBOARD,
        ...(forwarded === null ? {} : { "x-forwarded-for": forwarded }),
        ...extra.headers,
      },
      body: JSON.stringify(body),
    }),
    extra.peer,
  )

const signIn = (server: Server, forwarded: string | null, peer?: string) =>
  post(server, "/auth/sign-in/email", { email: "nobody@test.dev", password: "wrong-password" }, forwarded, { peer })

const keys = async () => (await db.select().from(rateLimit)).map((row) => row.key.split("|")[0])
const countOf = async (ip: string) => (await keys()).filter((key) => key === ip).length

async function burst(server: Server, times: number, forwarded: string | null, peer?: string): Promise<number[]> {
  const statuses: number[] = []
  for (let i = 0; i < times; i++) statuses.push((await signIn(server, forwarded, peer)).status)
  return statuses
}

test("sign-in attempts are limited per ip in the database, and another ip is not affected", async () => {
  const server = build()
  const statuses = await burst(server, 11, "203.0.113.7")
  expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true)
  expect(statuses[10]).toBe(429)
  expect((await signIn(server, "203.0.113.8")).status).not.toBe(429)
  expect(await countOf("203.0.113.7")).toBeGreaterThan(0)
})

test("a header with two values is read from the right: what the client put on the left changes nothing", async () => {
  const server = build({ header: "x-forwarded-for", trustedProxies: 1 })
  const statuses: number[] = []
  for (let i = 0; i < 11; i++) statuses.push((await signIn(server, `198.51.100.${i}, 203.0.113.50`)).status)
  expect(statuses[10]).toBe(429)
  expect(await countOf("203.0.113.50")).toBeGreaterThan(0)
  expect(await countOf("no-trusted-ip")).toBe(0)
})

test("two proxies in front: the entry two from the right is the client", async () => {
  const server = build({ header: "x-forwarded-for", trustedProxies: 2 })
  const statuses: number[] = []
  for (let i = 0; i < 11; i++) statuses.push((await signIn(server, `198.51.100.${i}, 203.0.113.60, 10.0.0.1`)).status)
  expect(statuses[10]).toBe(429)
  expect(await countOf("203.0.113.60")).toBeGreaterThan(0)
})

test("no header: the connection's own address is the client", async () => {
  const server = build()
  const statuses = await burst(server, 11, null, "203.0.113.70")
  expect(statuses[10]).toBe(429)
  expect((await signIn(server, null, "203.0.113.71")).status).not.toBe(429)
})

test("with no proxy trusted the header is ignored, so rotating it buys nothing", async () => {
  const server = build({ header: "x-forwarded-for", trustedProxies: 0 })
  const statuses: number[] = []
  for (let i = 0; i < 11; i++) statuses.push((await signIn(server, `198.51.100.${i}`, "203.0.113.80")).status)
  expect(statuses[10]).toBe(429)
})

test("a client with no address at all shares a looser bucket, and can't lock out anyone who has one", async () => {
  const server = build()
  const statuses = await burst(server, 15, null)
  expect(statuses.every((status) => status !== 429)).toBe(true)
  expect(await countOf(UNKNOWN_CLIENT_IP)).toBe(1)
  expect(await countOf("no-trusted-ip")).toBe(0)
  expect((await signIn(server, "203.0.113.90")).status).not.toBe(429)
})

test("a header a client sets for the address is replaced, never trusted", async () => {
  const server = build()
  const hostile = { "x-skiffr-client-ip": "203.0.113.99" }
  for (let i = 0; i < 3; i++) {
    await post(server, "/auth/sign-in/email", { email: "a@test.dev", password: "wrong-password" }, "203.0.113.91", {
      headers: hostile,
    })
  }
  expect(await countOf("203.0.113.99")).toBe(0)
  expect(await countOf("203.0.113.91")).toBeGreaterThan(0)
})

test("a signed-in user gets a 429 with a wait time and a Retry-After header from the rpc once the bucket is empty", async () => {
  const server = build()
  const signUp = await post(
    server,
    "/auth/sign-up/email",
    { email: "ana@test.dev", name: "Ana", password: "a-long-enough-password" },
    "198.51.100.1",
  )
  expect(signUp.status).toBe(200)
  const cookie = (signUp.headers.getSetCookie() as string[]).map((value) => value.split(";")[0]).join("; ")
  const read = () =>
    post(server, "/rpc/profile/get", {}, "198.51.100.1", { headers: { cookie, "x-csrf-token": "orpc" } })

  expect((await read()).status).toBe(200)
  expect((await read()).status).toBe(200)
  const limited = await read()
  expect(limited.status).toBe(429)
  expect(limited.headers.get("retry-after")).toBe("1")
  expect((await limited.json()).json).toMatchObject({
    code: "TOO_MANY_REQUESTS",
    status: 429,
    data: { retryAfterSeconds: 1 },
  })
})

test("rows older than a day are pruned, newer ones stay", async () => {
  const now = new Date("2026-11-12T12:00:00Z")
  await db.insert(rateLimit).values([
    { id: "old", key: "9.9.9.9|/made-up", count: 1, lastRequest: now.getTime() - 25 * 3_600_000 },
    { id: "new", key: "9.9.9.8|/made-up", count: 1, lastRequest: now.getTime() - 3_600_000 },
  ])
  await pruneRateLimits(db, now)
  const left = (await db.select().from(rateLimit)).map((row) => row.id)
  expect(left).toContain("new")
  expect(left).not.toContain("old")
})
