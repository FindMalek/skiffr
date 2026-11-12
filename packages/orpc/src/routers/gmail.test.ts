import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test"
import { call } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { type Db, gmailAccount, gmailMessage } from "@skiffr/db"
import { eq } from "drizzle-orm"
import type { Context } from "../context"
import { syncAccount, TokenCache } from "../lib/gmail"
import { LINKEDIN_ALERT, NEWSLETTER } from "../lib/gmail/fixtures"
import { type MockGoogle, startMockGoogle } from "../lib/gmail/mock-google"
import { connectAccount, connectDb, type Harness, harness, LINKEDIN_FROM, NOW } from "../lib/gmail/test-support"
import { TOKEN_PROCEDURES } from "../procedures"
import { appRouter } from "./index"

let db: Db
let drop: () => Promise<void>
let mock: MockGoogle
let h: Harness
const clock = NOW

beforeAll(async () => {
  const connected = await connectDb(["ana", "ben", "cy"])
  db = connected.db
  drop = connected.drop
})
afterAll(async () => {
  await drop()
})
beforeEach(async () => {
  mock = await startMockGoogle()
  h = harness(mock)
})
afterEach(async () => {
  await mock.close()
})

function as(userId: string, configured = true): { context: Context } {
  return {
    context: {
      db,
      now: () => clock,
      session: { user: { id: userId } } as Session,
      headers: new Headers({ "x-csrf-token": "orpc" }),
      bearer: false,
      gmail: configured ? { runtime: h.runtime, tokens: new TokenCache() } : null,
    } as unknown as Context,
  }
}

test("without a google client the status says so and syncing is unavailable", async () => {
  expect(await call(appRouter.gmail.status, undefined, as("ana", false))).toMatchObject({
    configured: false,
    connected: false,
    email: null,
  })
  await expect(call(appRouter.gmail.syncNow, undefined, as("ana", false))).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  })
})

test("status and recent show the connection and what came from where, never the stored token or an email body", async () => {
  const { id, refreshToken } = await connectAccount(db, mock, "ana")
  expect(await call(appRouter.gmail.status, undefined, as("ana"))).toMatchObject({
    configured: true,
    connected: true,
    status: "active",
    lastSyncAt: null,
  })

  mock.add({ id: "r1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  mock.add({ id: "r2", from: LINKEDIN_FROM, html: NEWSLETTER })
  await syncAccount({ db, runtime: h.runtime, now: () => clock, tokens: new TokenCache() }, id)

  const status = await call(appRouter.gmail.status, undefined, as("ana"))
  expect(status).toMatchObject({
    email: "ana.inbox@example.test",
    counts: { emails: 2, jobs: 2 },
    label: "skiffr/jobs",
  })
  const recent = await call(appRouter.gmail.recent, { limit: 10 }, as("ana"))
  expect(recent.map((m) => [m.source, m.outcome, m.tidied, m.jobs.length]).sort()).toEqual([
    ["gmail:linkedin", "imported", true, 2],
    ["gmail:linkedin", "no_jobs", false, 0],
  ])
  const imported = recent.find((m) => m.outcome === "imported")!
  expect(imported.jobs.map((j) => [j.title, j.company]).sort()).toEqual([
    ["Backend Developer", "Globex"],
    ["Senior Software Engineer", "Acme Labs"],
  ])
  const [row] = await db.select().from(gmailAccount).where(eq(gmailAccount.userId, "ana"))
  const everything = JSON.stringify([status, recent])
  expect(everything).not.toContain(refreshToken)
  expect(everything).not.toContain(row!.refreshTokenEnc)
  expect(everything).not.toContain("jobalerts-noreply")
  expect(Object.keys(recent[0]!).sort()).toEqual([
    "id",
    "jobs",
    "jobsFound",
    "jobsNew",
    "outcome",
    "processedAt",
    "source",
    "tidied",
  ])
})

test("another user sees nothing of it and can't touch it", async () => {
  expect(await call(appRouter.gmail.status, undefined, as("ben"))).toMatchObject({
    connected: false,
    counts: { emails: 0, jobs: 0 },
  })
  expect(await call(appRouter.gmail.recent, {}, as("ben"))).toEqual([])
  await expect(call(appRouter.gmail.senders.add, { sender: "x@site.com" }, as("ben"))).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
  await expect(call(appRouter.gmail.syncNow, undefined, as("ben"))).rejects.toMatchObject({ code: "NOT_FOUND" })
  await expect(call(appRouter.gmail.disconnect, undefined, as("ben"))).rejects.toMatchObject({ code: "NOT_FOUND" })
  expect((await call(appRouter.gmail.senders.list, undefined, as("ben"))).senders).toEqual(
    (await call(appRouter.gmail.senders.list, undefined, as("ben"))).defaults,
  )
})

test("senders are validated and normalized, capped, and concurrent edits all land", async () => {
  await connectAccount(db, mock, "cy", { senders: [] })
  const add = (sender: string) => call(appRouter.gmail.senders.add, { sender }, as("cy"))
  for (const bad of ["not an address", "a@b", "x@y.com OR from:z", "a@b.com)"]) {
    await expect(add(bad), bad).rejects.toMatchObject({ code: "BAD_REQUEST" })
  }
  expect((await add(" Jobs@Site.COM ")).senders).toEqual(["jobs@site.com"])
  expect((await add("jobs@site.com")).senders).toEqual(["jobs@site.com"])
  await Promise.all(["a.example", "b.example", "c.example", "d.example", "e.example"].map(add))
  const { senders } = await call(appRouter.gmail.senders.list, undefined, as("cy"))
  expect(senders.sort()).toEqual([
    "@a.example",
    "@b.example",
    "@c.example",
    "@d.example",
    "@e.example",
    "jobs@site.com",
  ])

  expect((await call(appRouter.gmail.senders.remove, { sender: "@A.example" }, as("cy"))).senders).not.toContain(
    "@a.example",
  )
  await db
    .update(gmailAccount)
    .set({ senders: Array.from({ length: 30 }, (_, i) => `s${i}@x.example`) })
    .where(eq(gmailAccount.userId, "cy"))
  await expect(add("one-more@x.example")).rejects.toMatchObject({ code: "BAD_REQUEST" })
})

test("syncing by hand is limited to once a minute", async () => {
  await connectAccount(db, mock, "ben")
  const first = await call(appRouter.gmail.syncNow, undefined, as("ben"))
  expect(first.state).toBe("done")
  await expect(call(appRouter.gmail.syncNow, undefined, as("ben"))).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })
})

test("disconnecting revokes, deletes the account and its records", async () => {
  const refreshToken = "rt-ben-secret"
  mock.refreshTokens.add(refreshToken)
  expect(await call(appRouter.gmail.disconnect, undefined, as("ben"))).toEqual({ revoked: true })
  expect(mock.revoked).toContain(refreshToken)
  expect(await db.select().from(gmailAccount).where(eq(gmailAccount.userId, "ben"))).toEqual([])
  expect(await db.select().from(gmailMessage).where(eq(gmailMessage.userId, "ben"))).toEqual([])
  expect(await call(appRouter.gmail.status, undefined, as("ben"))).toMatchObject({ connected: false })
})

test("gmail is session only: no procedure is on the token list and a valid extension token gets 403 on each", async () => {
  expect([...TOKEN_PROCEDURES].filter((path) => path.startsWith("gmail."))).toEqual([])
  const paths = ["status", "syncNow", "recent", "disconnect", "senders.list", "senders.add", "senders.remove"]
  const bearer = {
    context: {
      db,
      now: () => clock,
      session: null,
      headers: new Headers({ authorization: "Bearer skp_x" }),
      bearer: true,
      tokenUnavailable: false,
      token: { id: "t", name: "t", prefix: "skp_", last4: "xxxx", expiresAt: null, user: { id: "cy" } },
      gmail: { runtime: h.runtime, tokens: new TokenCache() },
    } as unknown as Context,
  }
  for (const path of paths) {
    const procedure = path
      .split(".")
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], appRouter.gmail) as Parameters<
      typeof call
    >[0]
    await expect(call(procedure, { sender: "a@b.com" } as never, bearer), path).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
  }
  const noCsrf = { context: { ...as("cy").context, headers: new Headers() } as Context }
  await expect(call(appRouter.gmail.status, undefined, noCsrf)).rejects.toMatchObject({ code: "FORBIDDEN" })
})
