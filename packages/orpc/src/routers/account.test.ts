import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test"
import { createRouterClient } from "@orpc/server"
import { createAuth } from "@skiffr/auth"
import { ACCOUNT_EXPORT_VERSION, EMBEDDING_DIMENSIONS } from "@skiffr/common/constants"
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
  profile,
  recordBatch,
  session as sessionTable,
  siteProfile,
  user,
  verification,
} from "@skiffr/db"
import type { Storage } from "@skiffr/storage"
import { eq, getTableName, ne, sql } from "drizzle-orm"
import { type Context, createContext } from "../context"
import { deleteAccount } from "../lib/account/delete"
import { buildExport, EXPORTED, NOT_EXPORTED } from "../lib/account/export"
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

/** What `connectDb` reads: decided when the file is collected, which is when `skipIf` is evaluated. */
const real = Boolean(process.env.TEST_DATABASE_URL)
const PASSWORD = "correct horse battery"
const EXPORT_KEYS: Record<string, string[]> = {
  account: ["createdAt", "email", "image", "name"],
  profile: ["createdAt", "data", "fields", "id", "updatedAt"],
  gmailAccount: [
    "createdAt",
    "email",
    "id",
    "labelId",
    "lastError",
    "lastManualSyncAt",
    "lastSyncAt",
    "nextAttemptAt",
    "scopes",
    "senders",
    "status",
    "updatedAt",
  ],
  cvConnection: ["baseResumeId", "baseResumeName", "baseUrl", "createdAt", "id", "updatedAt"],
  answers: [
    "createdAt",
    "fingerprint",
    "id",
    "lastCorrectedAt",
    "normalizedLabel",
    "rawLabel",
    "source",
    "status",
    "timesCleared",
    "timesCorrected",
    "timesUsed",
    "updatedAt",
    "value",
  ],
  jobs: ["canonicalId", "company", "createdAt", "id", "queuedAt", "source", "status", "title", "updatedAt", "url"],
  applications: [
    "appliedAt",
    "ats",
    "createdAt",
    "id",
    "interviewAt",
    "jobId",
    "matchScore",
    "offerAt",
    "rejectedAt",
    "respondedAt",
    "resumeId",
    "status",
    "updatedAt",
  ],
  fieldEvents: [
    "applicationId",
    "createdAt",
    "fieldType",
    "filledValue",
    "finalValue",
    "fingerprint",
    "id",
    "normalizedLabel",
    "outcome",
    "rawLabel",
    "siteKey",
    "source",
  ],
  siteProfiles: [
    "createdAt",
    "fieldKeys",
    "fieldMap",
    "formSignature",
    "id",
    "lastUsedAt",
    "siteKey",
    "timesUsed",
    "updatedAt",
  ],
  jobSources: [
    "createdAt",
    "enabled",
    "failures",
    "id",
    "kind",
    "label",
    "lastAdded",
    "lastCheckedAt",
    "lastError",
    "lastFound",
    "lastManualRunAt",
    "nextAttemptAt",
    "seenIds",
    "status",
    "updatedAt",
    "url",
  ],
  gmailMessages: ["googleMessageId", "id", "jobsFound", "jobsNew", "modifiedAt", "outcome", "processedAt", "provider"],
  tokens: ["createdAt", "expiresAt", "id", "lastUsedAt", "name", "revokedAt"],
  aiUsage: ["calls", "day", "inputTokens", "outputTokens", "verdicts"],
}
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

/** A cookie minted now, so it carries the role the user has now (a sign up cookie carries the role from before). */
async function signIn(email: string): Promise<string> {
  const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true })
  return headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ")
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
  await db.insert(verification).values([
    { id: crypto.randomUUID(), identifier: person.email, value: "v", expiresAt: new Date(NOW) },
    {
      id: crypto.randomUUID(),
      identifier: `magic-${id}`,
      value: JSON.stringify({ email: person.email, name: "n" }),
      expiresAt: new Date(NOW),
    },
  ])
}

/** Makes `ids` the only admins, so a test about the last admin doesn't depend on the order of the others. */
async function onlyAdmins(...ids: string[]): Promise<void> {
  await db.execute(sql`update "user" set role = null where role = 'admin'`)
  for (const id of ids) await db.update(user).set({ role: "admin" }).where(eq(user.id, id))
}

const verificationRows = async (person: Person) =>
  db
    .select()
    .from(verification)
    .where(sql`${verification.identifier} = ${person.email} or ${verification.identifier} = ${`magic-${person.id}`}`)

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
  // Every exported column is a decision: a new column (or a new secret one) fails here until it is listed.
  const exportedKeys = Object.fromEntries(
    Object.entries(first)
      .filter(([, section]) => section && typeof section === "object" && !(section instanceof Date))
      .map(([name, section]) => [name, Object.keys((Array.isArray(section) ? section[0]! : section) as object).sort()]),
  )
  expect(exportedKeys).toEqual(EXPORT_KEYS)
})

test("every table with a user id is exported or left out on purpose, and a table that holds a secret never is", async () => {
  const exported = EXPORTED.map(
    ({ table }) => (table as unknown as { [k: symbol]: string })[Symbol.for("drizzle:Name")],
  ).sort()
  const left = Object.keys(NOT_EXPORTED)
  expect([...exported, ...left].sort()).toEqual(await userTables())
  for (const reason of Object.values(NOT_EXPORTED)) expect(reason.length).toBeGreaterThan(10)
})

test("an account above the row or byte limit gets a clear error instead of a document", async () => {
  const big = await signUp("export-big")
  const [owner] = await db.select().from(user).where(eq(user.id, big.id))
  await db.execute(
    sql`insert into answer (user_id, normalized_label, raw_label, value) select ${big.id}, 'n' || g, 'n' || g, repeat('x', 10000) from generate_series(1, 2000) g`,
  )
  const buildWith = (rows: number, bytes: number) => buildExport(db, owner!, NOW, { rows, bytes })
  await expect(buildWith(100, 1e9)).rejects.toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
    message: expect.stringContaining("2000 rows"),
  })
  // 2000 answers of 10 kB are 20 MB however few rows that is: the stored size is compressed, the document is not.
  await expect(buildWith(1e9, 10 * 1024 * 1024)).rejects.toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
    message: expect.stringMatching(/about 20 MB; the limits are .* and 10 MB/),
  })
  expect((await buildWith(1e9, 30 * 1024 * 1024)).answers).toHaveLength(2000)
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
  expect(await verificationRows(ana)).toEqual([])
  expect(await verificationRows(ben)).toHaveLength(2)
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

test("a pending magic link is deleted for the exact email only, not for one that contains it", async () => {
  const al = await signUp("magic-a")
  const other = await signUp("magic-ba")
  const link = (identifier: string, email: string) => ({
    id: crypto.randomUUID(),
    identifier,
    value: JSON.stringify({ email, name: "n" }),
    expiresAt: new Date(NOW),
  })
  await db
    .insert(verification)
    .values([
      link("tok-exact", al.email),
      link("tok-longer", `b${al.email}`),
      link("tok-prefixed", `joe.${al.email}`),
      link("tok-other", other.email),
    ])
  await deleteAccount({ db, gmail: null, storage: null }, al)
  const left = (await db.select().from(verification).where(sql`${verification.identifier} like 'tok-%'`)).map(
    (row) => row.identifier,
  )
  expect(left.sort()).toEqual(["tok-longer", "tok-other", "tok-prefixed"])
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

test("an account without a password needs a recent sign in that the database still knows", async () => {
  const now = new Date()
  const old = new Date(now.getTime() - 60 * 60_000)
  const ids = ["oauth-old", "oauth-new", "oauth-gone"]
  await db
    .insert(user)
    .values(
      ids.map((id) => ({ id, name: id, email: `${id}@test.dev`, emailVerified: true, createdAt: now, updatedAt: now })),
    )
  const session = (id: string, createdAt: Date, row = true) => {
    const value = {
      id: `s-${id}`,
      userId: id,
      token: `t-${id}`,
      expiresAt: new Date(now.getTime() + 1e6),
      createdAt,
      updatedAt: createdAt,
    }
    return row ? db.insert(sessionTable).values(value) : Promise.resolve()
  }
  await session("oauth-old", old)
  await session("oauth-new", now)
  // the cookie cache says fresh, the database has no such session (revoked)
  await session("oauth-gone", now, false)
  const as = (id: string, createdAt: Date) =>
    createRouterClient(appRouter, {
      context: {
        db,
        auth,
        now: () => now,
        headers: new Headers({ "x-csrf-token": "orpc" }),
        session: { user: { id, email: `${id}@test.dev` }, session: { id: `s-${id}`, createdAt } },
        storage: null,
      } as unknown as Context,
    })
  for (const [id, at] of [
    ["oauth-old", now],
    ["oauth-gone", now],
  ] as const) {
    await expect(as(id, at).account.delete({ confirmEmail: `${id}@test.dev` })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(1)
  }
  await expect(as("oauth-new", now).account.delete({ confirmEmail: "oauth-new@test.dev" })).resolves.toMatchObject({
    ok: true,
    gmailRevoked: null,
  })
  expect(await db.select().from(user).where(eq(user.id, "oauth-new"))).toEqual([])
})

test("an admin signed in as someone else can't export or delete that account", async () => {
  const imp = await signUp("imp-target")
  await db.update(sessionTable).set({ impersonatedBy: "some-admin" }).where(eq(sessionTable.userId, imp.id))
  const client = await api(imp)
  await expect(client.account.export()).rejects.toMatchObject({ code: "FORBIDDEN" })
  await expect(client.account.delete({ confirmEmail: imp.email, password: PASSWORD })).rejects.toMatchObject({
    code: "FORBIDDEN",
  })
  expect(await db.select().from(user).where(eq(user.id, imp.id))).toHaveLength(1)
})

test("a failure that is not a wrong password is not reported as one", async () => {
  const fay = await signUp("password-fay")
  const context = await contextOf(fay)
  const broken = { ...context, auth: { api: { verifyPassword: async () => Promise.reject(new Error("db down")) } } }
  const client = createRouterClient(appRouter, { context: broken as unknown as Context })
  const error = await client.account.delete({ confirmEmail: fay.email, password: PASSWORD }).catch((e) => e)
  expect(error).toMatchObject({ message: "db down" })
})

test("a deleted user's cached session can't update, upload (no file is left) or list users", async () => {
  const first = await signUp("ghost-admin", "admin")
  const keep = await signUp("ghost-keeper", "admin")
  await onlyAdmins(first.id, keep.id)
  const ghost = { ...first, cookie: await signIn(first.email) }
  const storage = memoryStorage([])
  // the cookie carries the admin role, so only the database can tell it is gone
  await expect((await api(ghost, { storage })).admin.users()).resolves.toMatchObject({ users: expect.any(Array) })
  await (await api(ghost, { storage })).account.delete({ confirmEmail: ghost.email, password: PASSWORD })

  // the same cookie, answered from the session cache
  const stale = await api(ghost, { storage })
  const png = new File([new Uint8Array([137, 80, 78, 71])], "a.png", { type: "image/png" })
  await expect(stale.me.avatar({ file: png })).rejects.toMatchObject({ code: "NOT_FOUND" })
  await expect(stale.me.update({ name: "Still here" })).rejects.toMatchObject({ code: "NOT_FOUND" })
  await expect(stale.admin.users()).rejects.toMatchObject({ code: "FORBIDDEN" })
  expect([...storage.keys]).toEqual([])
})

test("the admin user list marks unverified and currently banned accounts, not an expired ban", async () => {
  const boss = await signUp("list-boss", "admin")
  const banned = await signUp("list-banned")
  const lapsed = await signUp("list-lapsed")
  await db.update(user).set({ banned: true }).where(eq(user.id, banned.id))
  await db
    .update(user)
    .set({ banned: true, banExpires: new Date(Date.now() - 60_000), emailVerified: true })
    .where(eq(user.id, lapsed.id))
  const { users } = await (await api({ ...boss, cookie: await signIn(boss.email) })).admin.users()
  const flags = (id: string) => {
    const row = users.find((u) => u.id === id)
    return { banned: row?.banned, emailVerified: row?.emailVerified }
  }
  expect(flags(banned.id)).toEqual({ banned: true, emailVerified: false })
  expect(flags(lapsed.id)).toEqual({ banned: false, emailVerified: true })
})

test("an upload that lands while the account is being deleted leaves no file behind", async () => {
  const gus = await signUp("upload-gus")
  const storage = memoryStorage([])
  // the account goes away between the check at the start of the request and its last write
  const slow: Storage = {
    ...storage,
    put: async (key, data, type) => {
      await storage.put(key, data, type)
      await db.delete(user).where(eq(user.id, gus.id))
    },
  }
  const png = new File([new Uint8Array([137, 80, 78, 71])], "a.png", { type: "image/png" })
  await expect((await api(gus, { storage: slow })).me.avatar({ file: png })).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
  expect([...storage.keys]).toEqual([])
})

test("every foreign key to the user is on delete cascade, so a table added later is deleted with the user", async () => {
  const rows = rowsOf<{ child: string; type: string }>(
    await db.execute(
      sql`select conrelid::regclass::text as child, confdeltype as type from pg_constraint where contype = 'f' and confrelid = '"user"'::regclass`,
    ),
  )
  expect(rows.length).toBeGreaterThan(10)
  expect(rows.filter((row) => row.type !== "c")).toEqual([])
})

test("the delete clears every table with a user id by itself, not only through the cascade", async () => {
  const ivy = await signUp("loop-ivy")
  await seed(ivy)
  const deleted: string[] = []
  const recording = (tx: object): object =>
    new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (prop !== "delete") return typeof value === "function" ? value.bind(target) : value
        return (table: never) => {
          deleted.push(getTableName(table))
          return (value as (t: never) => unknown).call(target, table)
        }
      },
    })
  const spy = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (prop !== "transaction") return typeof value === "function" ? value.bind(target) : value
      return (run: (tx: object) => unknown, config: unknown) =>
        (value as (...a: unknown[]) => unknown).call(target, (tx: object) => run(recording(tx)), config)
    },
  }) as unknown as Db
  await deleteAccount({ db: spy, gmail: null, storage: null }, ivy)
  expect(deleted).toEqual(expect.arrayContaining(await userTables()))
})

test("a picture that can't be deleted is logged by key and does not stop the others", async () => {
  const storage = memoryStorage(["pr-1/avatars/zed-1.png", "pr-1/avatars/zed-2.png", "pr-1/avatars/zed-3.png"])
  const flaky: Storage = {
    ...storage,
    delete: async (key) => {
      if (key.endsWith("-2.png")) throw new Error("s3 down")
      await storage.delete(key)
    },
  }
  const warned = spyOn(console, "warn").mockImplementation(() => {})
  await db
    .insert(user)
    .values({ id: "zed", name: "z", email: "zed@test.dev", emailVerified: true, createdAt: NOW, updatedAt: NOW })
  const result = await deleteAccount({ db, gmail: null, storage: flaky }, { id: "zed", email: "zed@test.dev" })
  const logged = JSON.stringify(warned.mock.calls)
  warned.mockRestore()
  expect(result.filesRemoved).toBe(false)
  expect([...storage.keys]).toEqual(["pr-1/avatars/zed-2.png"])
  expect(logged).toContain("pr-1/avatars/zed-2.png")
  expect(logged).not.toContain("zed@test.dev")
})

test("the last admin can't delete themselves, and a refused delete leaves Gmail connected", async () => {
  const solo = await signUp("admin-solo", "admin")
  await seed(solo)
  await onlyAdmins(solo.id)
  await expect(
    (await api(solo)).account.delete({ confirmEmail: solo.email, password: PASSWORD }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("last admin") })
  expect(mock.revoked).toEqual([])
  expect(Object.values(await counts(solo.id)).every((n) => n > 0)).toBe(true)
  expect(await db.select().from(user).where(eq(user.id, solo.id))).toHaveLength(1)
})

// advisory locks and the lock queue need real connections: pglite serializes everything
test.skipIf(!real)("two admins deleting at once never leave the instance without an admin", async () => {
  const [one, two] = [await signUp("race-admin-1", "admin"), await signUp("race-admin-2", "admin")]
  await onlyAdmins(one.id, two.id)
  const deps = { db, gmail: { runtime: h.runtime, tokens: h.tokens }, storage: null }
  const results = await Promise.allSettled([deleteAccount(deps, one), deleteAccount(deps, two)])
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { message: expect.stringContaining("last admin") },
  })
  expect(await db.select().from(user).where(eq(user.role, "admin"))).toHaveLength(1)
})

test.skipIf(!real)("deleting the same user at once answers both calls and leaves nothing", async () => {
  const rae = await signUp("race-rae")
  await seed(rae)
  const deps = { db, gmail: { runtime: h.runtime, tokens: h.tokens }, storage: null }
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => deleteAccount(deps, rae)))
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"])
  expect(Object.values(await counts(rae.id)).every((n) => n === 0)).toBe(true)
})

test("deleting the same user twice at once is fine", async () => {
  const sam = await signUp("twice-sam")
  await seed(sam)
  const deps = { db, gmail: { runtime: h.runtime, tokens: h.tokens }, storage: null }
  await Promise.all([deleteAccount(deps, sam), deleteAccount(deps, sam)])
  expect(Object.values(await counts(sam.id)).every((n) => n === 0)).toBe(true)
  expect(await db.select().from(user).where(ne(user.id, sam.id))).not.toContainEqual(
    expect.objectContaining({ id: sam.id }),
  )
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
