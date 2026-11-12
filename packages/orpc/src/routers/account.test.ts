import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test"
import { createRouterClient } from "@orpc/server"
import { createAuth } from "@skiffr/auth"
import { ACCOUNT_EXPORT_ROWS_MAX, ACCOUNT_EXPORT_VERSION, EMBEDDING_DIMENSIONS } from "@skiffr/common/constants"
import {
  aiUsage,
  answer,
  apiToken,
  application,
  cvConnection,
  type Db,
  fieldEvent,
  gmailMessage,
  gmailMessageJob,
  gmailOauthState,
  job,
  jobSource,
  notes,
  profile,
  recordBatch,
  siteProfile,
  user,
  verification,
} from "@skiffr/db"
import type { Storage } from "@skiffr/storage"
import { eq, sql } from "drizzle-orm"
import { type Context, createContext } from "../context"
import { deleteAccount } from "../lib/account/delete"
import { EXPORTED, NOT_EXPORTED } from "../lib/account/export"
import { type MockGoogle, startMockGoogle } from "../lib/gmail/mock-google"
import { connectAccount, connectDb, type Harness, harness, NOW } from "../lib/gmail/test-support"
import { RateLimiter } from "../lib/rate-limit"
import { limitClassOf } from "../procedures"
import { appRouter } from "./index"

let db: Db
let drop: () => Promise<void>
let mock: MockGoogle
let h: Harness
let auth: ReturnType<typeof createAuth>

const PASSWORD = "correct horse battery"
const SECRETS = ["token-hash-sentinel", "enc-sentinel", "verifier-sentinel", "etag-sentinel", "api-key-sentinel"]

beforeAll(async () => {
  const connected = await connectDb([])
  db = connected.db
  drop = connected.drop
  auth = createAuth({
    db,
    secret: "a".repeat(40),
    dashboardUrl: "http://dashboard.test",
    trustedOrigins: ["http://dashboard.test"],
    secureCookies: false,
    rateLimit: false,
  })
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

interface Person {
  id: string
  email: string
  cookie: string
  secret: string
}

function memoryStorage(keys: string[]): Storage & { keys: Set<string> } {
  const stored = new Set(keys)
  return {
    keys: stored,
    bucket: "test",
    prefix: "pr-1/",
    put: async (key) => void stored.add(key),
    url: (key) => key,
    list: async (prefix) => [...stored].filter((key) => key.startsWith(prefix)),
    delete: async (key) => void stored.delete(key),
  }
}

/** A real sign up and sign in through better-auth, so there is a real password hash and a real session to delete. */
async function signUp(tag: string, role?: string): Promise<Person> {
  const email = `${tag}@test.dev`
  const { headers, response } = await auth.api.signUpEmail({
    body: { name: `Name ${tag}`, email, password: PASSWORD },
    returnHeaders: true,
  })
  const cookie = headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ")
  if (role) await db.update(user).set({ role }).where(eq(user.id, response.user.id))
  return { id: response.user.id, email, cookie, secret: `private-${tag}` }
}

async function contextOf(
  person: Pick<Person, "cookie">,
  extra: { storage?: Storage | null; limits?: RateLimiter } = {},
): Promise<Context> {
  const headers = new Headers({ cookie: person.cookie, "x-csrf-token": "orpc" })
  const session = await auth.api.getSession({ headers })
  return {
    db,
    auth,
    now: () => new Date(),
    headers,
    session,
    bearer: false,
    token: null,
    tokenUnavailable: false,
    storage: extra.storage ?? null,
    gmail: { runtime: h.runtime, tokens: h.tokens },
    limits: extra.limits,
  } as unknown as Context
}

const api = async (person: Person, extra?: Parameters<typeof contextOf>[1]) =>
  createRouterClient(appRouter, { context: await contextOf(person, extra) })

/** One row in every table that has a user id, with a sentinel in each secret column. */
async function seed(person: Person): Promise<void> {
  const { id, secret } = person
  await db.insert(profile).values({ userId: id, data: { identity: { firstName: secret } } as never, fields: {} })
  await db.insert(answer).values({
    userId: id,
    normalizedLabel: "color",
    rawLabel: "Color",
    value: secret,
    embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.25),
  })
  const [posting] = await db
    .insert(job)
    .values({
      userId: id,
      url: `https://jobs.test/${id}`,
      canonicalId: id,
      title: secret,
      company: "Acme",
      source: "x",
    })
    .returning()
  const [applied] = await db
    .insert(application)
    .values({ userId: id, jobId: posting!.id, ats: "greenhouse" })
    .returning()
  await db.insert(fieldEvent).values({
    userId: id,
    applicationId: applied!.id,
    siteKey: "jobs.test",
    fingerprint: "f",
    normalizedLabel: "color",
    rawLabel: "Color",
    filledValue: "",
    finalValue: secret,
    source: "site",
    outcome: "accepted",
  })
  await db.insert(siteProfile).values({ userId: id, siteKey: "jobs.test", formSignature: "s", fieldKeys: ["a"] })
  await db.insert(recordBatch).values({ userId: id, batchId: crypto.randomUUID(), payloadHash: "h" })
  await db
    .insert(jobSource)
    .values({ userId: id, url: `https://careers.test/${id}`, etag: "etag-sentinel", leaseUntil: new Date(NOW) })
  await db.insert(apiToken).values({
    userId: id,
    name: "laptop",
    prefix: "skp_abcd",
    last4: "wxyz",
    tokenHash: `token-hash-sentinel-${id}`,
  })
  const { id: accountId } = await connectAccount(db, mock, id)
  const [message] = await db
    .insert(gmailMessage)
    .values({ userId: id, accountId, googleMessageId: `m-${id}`, provider: "other", outcome: "imported" })
    .returning()
  await db.insert(gmailMessageJob).values({ messageId: message!.id, jobId: posting!.id })
  await db.insert(gmailOauthState).values({
    userId: id,
    stateHash: `state-${id}`,
    codeVerifierEnc: "verifier-sentinel",
    returnTo: "/",
    expiresAt: new Date(NOW),
  })
  await db
    .insert(cvConnection)
    .values({ userId: id, baseUrl: "https://rr.test", apiKeyEnc: "api-key-sentinel", keyLast4: "1234" })
  await db.insert(aiUsage).values({ userId: id, day: "2026-11-10", calls: 3 })
  await db.insert(notes).values({ userId: id, title: secret })
  await db
    .insert(verification)
    .values({ id: crypto.randomUUID(), identifier: person.email, value: "v", expiresAt: new Date(NOW) })
}

const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[]

/** Every table that has a user id column, read from the database, so a table added later can't be missed. */
async function userTables(): Promise<string[]> {
  const rows = rowsOf<{ table_name: string }>(
    await db.execute(
      sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'`,
    ),
  )
  return rows.map((row) => row.table_name).sort()
}

async function counts(userId: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const table of await userTables()) {
    const [row] = rowsOf<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${userId}`),
    )
    result[table] = row!.n
  }
  return result
}

test("the export holds the user's data in a fixed order and none of the secrets or other people's rows", async () => {
  const ana = await signUp("export-ana")
  const ben = await signUp("export-ben")
  await seed(ana)
  await seed(ben)

  const first = await (await api(ana)).account.export()
  const second = await (await api(ana)).account.export()
  expect({ ...second, generatedAt: first.generatedAt }).toEqual(first)

  expect(first).toMatchObject({ version: ACCOUNT_EXPORT_VERSION, account: { email: ana.email } })
  expect(first.answers).toHaveLength(1)
  expect(first.fieldEvents[0]).toMatchObject({ finalValue: ana.secret })
  expect(first.profile).toMatchObject({ data: { identity: { firstName: ana.secret } } })
  expect(first.gmailMessages).toHaveLength(1)
  expect(first.cvConnection).toMatchObject({ baseUrl: "https://rr.test" })

  const text = JSON.stringify(first)
  for (const sentinel of [...SECRETS, ben.secret, ben.id, "skp_abcd", "wxyz", "1234"])
    expect(text).not.toContain(sentinel)
  const [account] = await db.query.account.findMany({ where: (t, { eq }) => eq(t.userId, ana.id) })
  expect(text).not.toContain(account!.password!)
  const keys = Object.values(first).flatMap((section) =>
    Array.isArray(section)
      ? section.flatMap(Object.keys)
      : section && typeof section === "object"
        ? Object.keys(section)
        : [],
  )
  expect(keys.filter((key) => /(hash|enc|embedding|password|secret|userId)$/i.test(key))).toEqual([])
})

test("every table with a user id is exported or left out on purpose, and a table that holds a secret never is", async () => {
  const exported = EXPORTED.map(
    ({ table }) => (table as unknown as { [k: symbol]: string })[Symbol.for("drizzle:Name")],
  ).sort()
  const left = Object.keys(NOT_EXPORTED)
  expect([...exported, ...left].sort()).toEqual(await userTables())
  for (const reason of Object.values(NOT_EXPORTED)) expect(reason.length).toBeGreaterThan(10)
})

test("an account above the row limit gets a clear error instead of a document", async () => {
  const big = await signUp("export-big")
  await db.execute(
    sql`insert into notes (user_id, title) select ${big.id}, 'n' || g from generate_series(1, ${ACCOUNT_EXPORT_ROWS_MAX + 1}) g`,
  )
  await expect((await api(big)).account.export()).rejects.toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
    message: expect.stringContaining(String(ACCOUNT_EXPORT_ROWS_MAX)),
  })
})

test("deleting removes every row of the user in every table, revokes Google, ends sessions and tokens, and leaves others alone", async () => {
  const ana = await signUp("delete-ana")
  const ben = await signUp("delete-ben")
  await seed(ana)
  await seed(ben)
  const storage = memoryStorage([
    `pr-1/avatars/${ana.id}-1.png`,
    `pr-1/avatars/${ana.id}-2.webp`,
    `pr-1/avatars/${ben.id}-1.png`,
    `pr-1/avatars/${ana.id}-extra-1.png`,
  ])
  const refreshToken = [...mock.refreshTokens].find((token) => token.includes(ana.id))!
  const bensBefore = await counts(ben.id)
  const before = await counts(ana.id)
  for (const [table, n] of Object.entries(before)) expect(n, `${table} needs a seeded row`).toBeGreaterThan(0)
  const minted = await (await api(ana)).tokens.create({ name: "x", expiresInDays: 30 })
  const logged = [spyOn(console, "info"), spyOn(console, "error"), spyOn(console, "log")].map((spy) =>
    spy.mockImplementation(() => {}),
  )

  const result = await (await api(ana, { storage })).account.delete({
    confirmEmail: ana.email.toUpperCase(),
    password: PASSWORD,
  })

  const lines = JSON.stringify(logged.flatMap((spy) => spy.mock.calls))
  for (const spy of logged) spy.mockRestore()
  expect(result).toEqual({ ok: true, gmailRevoked: true, filesRemoved: true })
  expect(Object.values(await counts(ana.id)).every((n) => n === 0)).toBe(true)
  expect(await db.select().from(user).where(eq(user.id, ana.id))).toEqual([])
  expect(await db.select().from(verification).where(eq(verification.identifier, ana.email))).toEqual([])
  expect(await counts(ben.id)).toEqual(bensBefore)
  expect(await db.select().from(user).where(eq(user.id, ben.id))).toHaveLength(1)

  expect(mock.revoked).toContain(refreshToken)
  expect([...storage.keys].sort()).toEqual(
    [`pr-1/avatars/${ana.id}-extra-1.png`, `pr-1/avatars/${ben.id}-1.png`].sort(),
  )
  // The signed session cookie cache (5 minutes, `createAuth`) can still answer for the dashboard until it expires: every read then finds nothing and every write hits the user foreign key.
  expect(
    await auth.api.getSession({ headers: new Headers({ cookie: ana.cookie }), query: { disableCookieCache: true } }),
  ).toBeNull()
  const asToken = await createContext(
    { db, now: () => new Date() } as never,
    new Headers({ authorization: `Bearer ${minted.secret}` }),
  )
  await expect(createRouterClient(appRouter, { context: asToken }).extension.whoami()).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  })
  // A background run that still holds the user can't bring a row back: it hits the user foreign key.
  const late = async () =>
    db
      .insert(job)
      .values({ userId: ana.id, url: "https://late.test", canonicalId: "late", title: "t", company: "c", source: "x" })
  await expect(late()).rejects.toThrow()

  for (const personal of [ana.id, ana.email, ana.secret, "Name delete-ana", refreshToken])
    expect(lines).not.toContain(personal)
})

test("a wrong email, a missing password or a wrong one delete nothing and revoke nothing", async () => {
  const cy = await signUp("refuse-cy")
  await seed(cy)
  const before = await counts(cy.id)
  const client = await api(cy)
  await expect(client.account.delete({ confirmEmail: "someone@else.dev", password: PASSWORD })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  })
  await expect(client.account.delete({ confirmEmail: cy.email })).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  await expect(client.account.delete({ confirmEmail: cy.email, password: "not the password" })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "Wrong password.",
  })
  expect(await counts(cy.id)).toEqual(before)
  expect(mock.revoked).toEqual([])
})

test("a Gmail revoke that fails still deletes everything and says so", async () => {
  const dee = await signUp("revoke-dee")
  await seed(dee)
  mock.fail({ match: /revoke/, status: 500, times: 10 })
  const result = await (await api(dee)).account.delete({ confirmEmail: dee.email, password: PASSWORD })
  expect(result).toMatchObject({ ok: true, gmailRevoked: false })
  expect(Object.values(await counts(dee.id)).every((n) => n === 0)).toBe(true)
})

test("an account without a password needs a recent sign in", async () => {
  const now = new Date()
  const old = new Date(now.getTime() - 60 * 60_000)
  await db.insert(user).values([
    { id: "oauth-old", name: "o", email: "old@test.dev", emailVerified: true, createdAt: now, updatedAt: now },
    { id: "oauth-new", name: "n", email: "new@test.dev", emailVerified: true, createdAt: now, updatedAt: now },
  ])
  const as = (id: string, email: string, signedInAt: Date) =>
    createRouterClient(appRouter, {
      context: {
        db,
        auth,
        now: () => now,
        headers: new Headers({ "x-csrf-token": "orpc" }),
        session: { user: { id, email }, session: { createdAt: signedInAt } },
        storage: null,
      } as unknown as Context,
    })
  await expect(
    as("oauth-old", "old@test.dev", old).account.delete({ confirmEmail: "old@test.dev" }),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
  })
  expect(await db.select().from(user).where(eq(user.id, "oauth-old"))).toHaveLength(1)
  await expect(
    as("oauth-new", "new@test.dev", now).account.delete({ confirmEmail: "new@test.dev" }),
  ).resolves.toMatchObject({
    ok: true,
    gmailRevoked: null,
  })
  expect(await db.select().from(user).where(eq(user.id, "oauth-new"))).toEqual([])
})

test("deleting twice at once is fine, and the last admin can't delete themselves", async () => {
  const solo = await signUp("admin-solo", "admin")
  await seed(solo)
  await expect(
    (await api(solo)).account.delete({ confirmEmail: solo.email, password: PASSWORD }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("last admin") })
  expect(mock.revoked).toEqual([])
  expect(await db.select().from(user).where(eq(user.id, solo.id))).toHaveLength(1)

  await signUp("admin-second", "admin")
  const deps = { db, gmail: { runtime: h.runtime, tokens: h.tokens }, storage: null }
  const results = await Promise.all([deleteAccount(deps, solo), deleteAccount(deps, solo)])
  expect(results).toHaveLength(2)
  expect(Object.values(await counts(solo.id)).every((n) => n === 0)).toBe(true)
})

test("a token can't export or delete, and the pair is limited to a few tries a minute", async () => {
  const eve = await signUp("limit-eve")
  const { secret } = await (await api(eve)).tokens.create({ name: "x", expiresInDays: 30 })
  const context = await createContext(
    { db, now: () => new Date() } as never,
    new Headers({ authorization: `Bearer ${secret}` }),
  )
  const asToken = createRouterClient(appRouter, { context })
  await expect(asToken.account.export()).rejects.toMatchObject({ code: "FORBIDDEN" })
  await expect(asToken.account.delete({ confirmEmail: eve.email })).rejects.toMatchObject({ code: "FORBIDDEN" })

  expect(limitClassOf("account.export", "GET")).toBe("sensitive")
  expect(limitClassOf("account.delete", "POST")).toBe("sensitive")
  const client = await api(eve, { limits: new RateLimiter() })
  const wrong = () => client.account.delete({ confirmEmail: "nobody@else.dev" }).catch((error) => error.code)
  expect(await Promise.all(Array.from({ length: 6 }, wrong))).toEqual([
    "BAD_REQUEST",
    "BAD_REQUEST",
    "BAD_REQUEST",
    "BAD_REQUEST",
    "BAD_REQUEST",
    "TOO_MANY_REQUESTS",
  ])
})
