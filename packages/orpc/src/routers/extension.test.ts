import { afterAll, beforeAll, expect, test } from "bun:test"
import { call, createRouterClient } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { CLIENT_HEADER } from "@skiffr/common/utils"
import { apiToken, type Db, fieldEvent } from "@skiffr/db"
import { eq } from "drizzle-orm"
import { type Context, createContext } from "../context"
import { connectDb } from "../lib/gmail/test-support"
import { appRouter } from "./index"

let db: Db
let drop: () => Promise<void>

beforeAll(async () => {
  const connected = await connectDb(["ana", "ben"])
  db = connected.db
  drop = connected.drop
})
afterAll(async () => {
  await drop()
})

const NOW = new Date("2026-11-10T10:00:00Z")
const HOUR = 60 * 60 * 1000

const session = (userId: string, now = NOW) =>
  ({
    context: {
      db,
      now: () => now,
      session: { user: { id: userId } } as Session,
      headers: new Headers({ "x-csrf-token": "orpc" }),
    } as unknown as Context,
  }) as const

async function mint(userId: string) {
  return call(appRouter.tokens.create, { name: "laptop", expiresInDays: 30 }, session(userId))
}

async function asToken(secret: string, now: Date, client?: string) {
  const headers = new Headers({ authorization: `Bearer ${secret}` })
  if (client) headers.set(CLIENT_HEADER, client)
  return createRouterClient(appRouter, { context: await createContext({ db, now: () => now } as never, headers) })
}

const status = (userId: string, now = NOW) => call(appRouter.extension.status, undefined, session(userId, now))
const stored = async (id: string) => (await db.select().from(apiToken).where(eq(apiToken.id, id)))[0]

test("a user who never connected is never seen, and a token that was minted but not used still is", async () => {
  expect(await status("ben")).toMatchObject({ state: "never", lastSeenAt: null, client: null, version: "unknown" })
  await mint("ben")
  expect((await status("ben")).state).toBe("never")
})

test("the client header is stored on use and listed, and a client without it still works", async () => {
  const { id, secret } = await mint("ana")
  await (await asToken(secret, NOW)).extension.whoami()
  expect(await stored(id)).toMatchObject({ client: null, clientVersion: null })
  expect(await status("ana")).toMatchObject({ state: "connected", client: null, version: "unknown" })

  await (await asToken(secret, new Date(NOW.getTime() + 61_000), "extension-chrome/0.1.0")).extension.whoami()
  const listed = (await call(appRouter.tokens.list, undefined, session("ana"))).find((t) => t.id === id)
  expect(listed).toMatchObject({ client: "extension-chrome", clientVersion: "0.1.0" })
})

test("a new version shows at once, a junk header changes nothing, and nothing but name and version is kept", async () => {
  const { id, secret } = await mint("ana")
  await (await asToken(secret, NOW, "extension-firefox/0.1.0")).extension.whoami()
  await (await asToken(secret, new Date(NOW.getTime() + 1000), "extension-firefox/0.2.0")).extension.whoami()
  expect(await stored(id)).toMatchObject({ client: "extension-firefox", clientVersion: "0.2.0" })

  await (await asToken(secret, new Date(NOW.getTime() + 120_000), "Mozilla/5.0 (X11; Linux x86_64)")).extension.whoami()
  expect(await stored(id)).toMatchObject({ client: "extension-firefox", clientVersion: "0.2.0" })
})

test("status reports connected, stale and a version below the api's minimum, for the caller only", async () => {
  const { secret } = await mint("ben")
  await (await asToken(secret, NOW, "extension-chrome/0.0.0")).extension.whoami()
  expect(await status("ben", new Date(NOW.getTime() + HOUR))).toMatchObject({
    state: "connected",
    clientVersion: "0.0.0",
    version: "update-needed",
    minExtensionVersion: expect.any(String),
  })
  expect((await status("ben", new Date(NOW.getTime() + 25 * HOUR))).state).toBe("stale")
  expect((await status("ben", new Date(NOW.getTime() - 1))).state).toBe("connected")
})

test("lastFillAt is the newest field event of the caller", async () => {
  const at = new Date(NOW.getTime() - 3 * HOUR)
  const row = {
    siteKey: "jobs.acme.dev",
    fingerprint: "f",
    normalizedLabel: "color",
    rawLabel: "Color",
    filledValue: "",
    finalValue: "green",
    source: "site",
    outcome: "accepted",
  } as const
  await db.insert(fieldEvent).values([
    { ...row, userId: "ana", createdAt: at },
    { ...row, userId: "ben", createdAt: new Date(NOW.getTime() - HOUR) },
  ])
  expect((await status("ana")).lastFillAt).toEqual(at)
})

test("whoami hands the extension the minimum version it needs", async () => {
  const { secret } = await mint("ana")
  expect((await (await asToken(secret, NOW)).extension.whoami()).minExtensionVersion).toMatch(/^\d+\.\d+\.\d+$/)
})
