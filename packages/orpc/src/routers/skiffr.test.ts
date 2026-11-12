import { afterAll, beforeAll, expect, spyOn, test } from "bun:test"
import { inspect } from "node:util"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { call, createRouterClient } from "@orpc/server"
import { mockModel } from "@skiffr/ai/testing"
import type { Session } from "@skiffr/auth"
import { answer, answerColumns, apiToken, type Db, findSimilarAnswers, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb, strictDateSerializers } from "@skiffr/db/test-db"
import { APICallError } from "ai"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { type Context, createContext } from "../context"
import { errorMessage } from "../errors"
import { hashToken } from "../lib/tokens"
import { TOKEN_PROCEDURES } from "../procedures"
import { appRouter } from "./index"

const NOW = new Date("2026-11-10T10:00:00Z")
let db: Db

const DRIZZLE = new URL("../../../db/drizzle", import.meta.url).pathname

let drop: (() => Promise<void>) | undefined

/** TEST_DATABASE_URL runs the suite on a fresh `skiffr_test_*` database of that server, otherwise in-process pglite. */
async function connect(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL
  if (url) {
    const test = await createTestDb(url)
    drop = test.drop
    return test.db
  }
  const pg = drizzle(new PGlite({ extensions: { vector }, serializers: strictDateSerializers }), { schema })
  await migrate(pg, { migrationsFolder: DRIZZLE })
  return pg as unknown as Db
}

afterAll(async () => {
  await drop?.()
})

beforeAll(async () => {
  db = await connect()
  const now = new Date()
  await db.insert(user).values(
    ["ana", "ben"].map((id) => ({
      id,
      name: id,
      email: `${id}@test.dev`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  )
})

/** Only the better-auth session is faked: it is the external boundary, everything else is the real router on pglite, or on postgres when TEST_DATABASE_URL is set. */
function as(userId: string, now = NOW): Context {
  const session = { user: { id: userId } } as Session
  return {
    db,
    now: () => now,
    session,
    headers: new Headers({ "x-csrf-token": "orpc" }),
  } as unknown as Context
}

const ana = () => ({ context: as("ana") })
const ben = () => ({ context: as("ben") })

const POSTING = {
  url: "https://jobs.acme.dev/1",
  title: "Engineer",
  company: "Acme",
  source: "greenhouse",
}

test("saving an answer under a differently written label updates the same row", async () => {
  const first = await call(appRouter.answers.create, { rawLabel: "Years of experience?", value: "5" }, ana())
  const second = await call(
    appRouter.answers.create,
    { rawLabel: "  years of EXPERIENCE ", value: "6", source: "ai" },
    ana(),
  )
  expect(second.id).toBe(first.id)
  expect(second.normalizedLabel).toBe("years of experience")
  expect(second).toMatchObject({ value: "6", source: "ai", rawLabel: "years of EXPERIENCE" })
  expect(await call(appRouter.answers.list, undefined, ben())).toEqual([])
})

test("concurrent uses are all counted, and a correction only when the user changed the value", async () => {
  const saved = await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Ana" }, ana())
  await Promise.all(
    Array.from({ length: 8 }, (_, i) => call(appRouter.answers.recordUse, { id: saved.id, corrected: i < 3 }, ana())),
  )
  const [row] = (await call(appRouter.answers.list, undefined, ana())).filter((a) => a.id === saved.id)
  expect(row).toMatchObject({ timesUsed: 8, timesCorrected: 3 })
})

test("a profile is one per user, and extra fields are stored under normalized labels", async () => {
  await call(appRouter.profile.upsert, { data: { identity: { firstName: "Ben" } } }, ben())
  const row = await call(
    appRouter.profile.upsert,
    { data: { salary: { currency: "EUR", min: 60000, period: "year" } }, fields: { "Notice Period!": "1 month" } },
    ben(),
  )
  expect(row.data.salary.min).toBe(60000)
  expect(row.data.identity).toEqual({})
  expect(row.fields).toEqual({ "notice period": "1 month" })
  expect(await call(appRouter.profile.get, undefined, ana())).toBeNull()
})

test("profile fields with an empty or colliding normalized label are rejected", async () => {
  const upsert = (fields: Record<string, string>) => call(appRouter.profile.upsert, { fields }, ana())
  await expect(upsert({ "!!!": "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  await expect(upsert({ "Notice period": "1", "notice  PERIOD?": "2" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
})

test("urls that aren't http(s) are rejected on jobs, sources and profile links", async () => {
  const bad = "javascript:alert(1)"
  await expect(call(appRouter.jobs.create, { ...POSTING, url: bad }, ana())).rejects.toMatchObject({
    code: "BAD_REQUEST",
  })
  await expect(
    call(appRouter.jobSources.create, { url: "file:///etc/passwd", label: "x" }, ana()),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
  })
  await expect(call(appRouter.profile.upsert, { data: { links: { github: bad } } }, ana())).rejects.toMatchObject({
    code: "BAD_REQUEST",
  })
})

test("queueing the same posting twice returns the saved job", async () => {
  const job = await call(appRouter.jobs.create, POSTING, ana())
  const again = await call(appRouter.jobs.create, { ...POSTING, title: "Changed" }, ana())
  expect(again).toMatchObject({ id: job.id, title: "Engineer", status: "queued" })
  expect(await call(appRouter.jobs.list, { status: "skipped" }, ana())).toEqual([])
})

test("lists are paged and capped", async () => {
  await call(appRouter.jobs.create, { ...POSTING, url: "https://jobs.acme.dev/p1" }, ben())
  await call(appRouter.jobs.create, { ...POSTING, url: "https://jobs.acme.dev/p2" }, ben())
  expect(await call(appRouter.jobs.list, { limit: 1 }, ben())).toHaveLength(1)
  expect(await call(appRouter.jobs.list, { limit: 1, offset: 1 }, ben())).toHaveLength(1)
  await expect(call(appRouter.jobs.list, { limit: 501 }, ben())).rejects.toMatchObject({ code: "BAD_REQUEST" })
})

test("jobs can be queued or skipped by hand but never set to applied", async () => {
  const job = await call(appRouter.jobs.create, { ...POSTING, url: "https://jobs.acme.dev/s" }, ana())
  expect((await call(appRouter.jobs.update, { id: job.id, status: "skipped" }, ana())).status).toBe("skipped")
  await expect(call(appRouter.jobs.update, { id: job.id, status: "applied" as "queued" }, ana())).rejects.toMatchObject(
    {
      code: "BAD_REQUEST",
    },
  )
})

test("applying marks the job applied, and each funnel stage is stamped once", async () => {
  const job = await call(
    appRouter.jobs.create,
    { ...POSTING, url: "https://jobs.acme.dev/2", title: "Designer" },
    ana(),
  )
  const app = await call(appRouter.applications.create, { jobId: job.id, ats: "lever", matchScore: 82 }, ana())
  expect(app).toMatchObject({ status: "applied", matchScore: 82, respondedAt: null })
  expect((await call(appRouter.jobs.list, { status: "applied" }, ana())).map((j) => j.id)).toContain(job.id)

  const later = new Date("2026-11-12T10:00:00Z")
  const responded = await call(appRouter.applications.update, { id: app.id, status: "responded" }, ana())
  const again = await call(
    appRouter.applications.update,
    { id: app.id, status: "responded" },
    { context: as("ana", later) },
  )
  expect(responded.respondedAt).toEqual(NOW)
  expect(again.respondedAt).toEqual(NOW)

  await expect(call(appRouter.applications.create, { jobId: job.id, ats: "lever" }, ana())).rejects.toMatchObject({
    code: "CONFLICT",
  })
  await expect(call(appRouter.applications.create, { jobId: job.id, ats: "lever" }, ben())).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
  await expect(call(appRouter.jobs.update, { id: job.id, status: "skipped" }, ana())).rejects.toMatchObject({
    code: "CONFLICT",
  })
})

test("removing an application puts its job back in the queue", async () => {
  const job = await call(appRouter.jobs.create, { ...POSTING, url: "https://jobs.acme.dev/3" }, ana())
  const app = await call(appRouter.applications.create, { jobId: job.id, ats: "lever" }, ana())
  await call(appRouter.applications.remove, { id: app.id }, ana())
  const [back] = (await call(appRouter.jobs.list, {}, ana())).filter((j) => j.id === job.id)
  expect(back?.status).toBe("queued")
})

test("a watched careers page is saved once however the url is written", async () => {
  const source = await call(
    appRouter.jobSources.create,
    { url: "https://Acme.dev/careers/#open", label: "Acme" },
    ana(),
  )
  expect(source).toMatchObject({ url: "https://acme.dev/careers", label: "Acme", kind: "auto", lastCheckedAt: null })
  expect((await call(appRouter.jobSources.create, { url: "https://acme.dev/careers", label: "Again" }, ana())).id).toBe(
    source.id,
  )
})

test("another user's rows are not found by any update or remove", async () => {
  const answer = await call(appRouter.answers.create, { rawLabel: "Own answer", value: "x" }, ana())
  const job = await call(appRouter.jobs.create, { ...POSTING, url: "https://jobs.acme.dev/own" }, ana())
  const application = await call(appRouter.applications.create, { jobId: job.id, ats: "lever" }, ana())
  const source = await call(appRouter.jobSources.create, { url: "https://own.dev/careers", label: "Own" }, ana())
  const asBen = ben()
  const attempts: Array<() => Promise<unknown>> = [
    () => call(appRouter.answers.update, { id: answer.id, value: "y" }, asBen),
    () => call(appRouter.answers.recordUse, { id: answer.id }, asBen),
    () => call(appRouter.answers.remove, { id: answer.id }, asBen),
    () => call(appRouter.jobs.update, { id: job.id, status: "skipped" }, asBen),
    () => call(appRouter.jobs.remove, { id: job.id }, asBen),
    () => call(appRouter.applications.update, { id: application.id, status: "offer" }, asBen),
    () => call(appRouter.applications.remove, { id: application.id }, asBen),
    () => call(appRouter.jobSources.update, { id: source.id, enabled: false }, asBen),
    () => call(appRouter.jobSources.remove, { id: source.id }, asBen),
  ]
  for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" })
})

test("a stored embedding round-trips, nearest answers come back by cosine distance and are never selected by the api", async () => {
  const unit = (i: number, tilt = 0) => Array.from({ length: 1536 }, (_, d) => (d === i ? 1 : d === 1 ? tilt : 0))
  const saved = await Promise.all(
    ["Embed near", "Embed mid", "Embed far", "Embed none"].map((rawLabel) =>
      call(appRouter.answers.create, { rawLabel, value: "x" }, ana()),
    ),
  )
  const [near, mid, far, none] = saved.map((a) => a.id)
  const stored = [
    [near!, unit(0, 0.1)],
    [mid!, unit(0, 1)],
    [far!, unit(1)],
  ] as const
  for (const [id, embedding] of stored) await db.update(answer).set({ embedding }).where(eq(answer.id, id))

  const [row] = await db.select({ embedding: answer.embedding }).from(answer).where(eq(answer.id, mid!))
  expect(row?.embedding).toEqual(unit(0, 1))

  const hits = await findSimilarAnswers(db, "ana", unit(0), 3)
  expect(hits.map((h) => h.id)).toEqual([near!, mid!, far!])
  expect(hits.map((h) => h.id)).not.toContain(none!)
  expect(await findSimilarAnswers(db, "ben", unit(0), 3)).toEqual([])

  const [selected] = await db.select(answerColumns).from(answer).where(eq(answer.id, near!))
  expect(selected?.id).toBe(near!)
  expect(Object.keys(selected!)).not.toContain("embedding")
  expect(Object.keys(hits[0]!)).not.toContain("embedding")
})

const mapReply = JSON.stringify({
  mappings: [
    { id: "f1", action: "profile", key: "fields.notice period", value: null, confidence: 0.9, reason: "notice" },
  ],
})
const withModel = (userId: string, model: ReturnType<typeof mockModel> | null) => ({
  context: { ...as(userId), model },
})

test("ai.mapFields maps against the caller's own saved profile", async () => {
  const { mappings } = await call(
    appRouter.ai.mapFields,
    { fields: [{ id: "f1", label: "Notice period" }] },
    withModel("ben", mockModel(mapReply)),
  )
  expect(mappings).toEqual([
    { id: "f1", action: "profile", key: "fields.notice period", confidence: 0.9, reason: "notice" },
  ])
})

test("ai.draftAnswer returns the draft, or an explicit not-ok state", async () => {
  const draft = (text: string) =>
    call(appRouter.ai.draftAnswer, { question: "Why us?" }, withModel("ben", mockModel(text)))
  expect(await draft("Because the product fits.")).toEqual({ ok: true, text: "Because the product fits." })
  expect(await draft("NO_ANSWER")).toEqual({ ok: false, reason: "not_enough_info" })
})

test("ai.mapFields rejects too many, too large and duplicate fields", async () => {
  const run = (fields: object[]) =>
    call(appRouter.ai.mapFields, { fields } as never, withModel("ben", mockModel(mapReply)))
  await expect(run(Array.from({ length: 61 }, (_, i) => ({ id: `f${i}` })))).rejects.toMatchObject({
    code: "BAD_REQUEST",
  })
  const big = Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`,
    label: "x".repeat(300),
    options: Array(50).fill("y".repeat(100)),
  }))
  await expect(run(big)).rejects.toMatchObject({ code: "BAD_REQUEST" })
  await expect(run([{ id: "f1" }, { id: "f1" }])).rejects.toMatchObject({ code: "BAD_REQUEST" })
})

test("ai calls need a session, a saved profile and a configured model", async () => {
  const input = { fields: [{ id: "f1" }] }
  const anonymous = { context: { ...as("ben"), session: null, model: mockModel(mapReply) } }
  await expect(call(appRouter.ai.mapFields, input, anonymous as never)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  await expect(call(appRouter.ai.mapFields, input, withModel("ana", mockModel(mapReply)))).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  })
  await expect(call(appRouter.ai.mapFields, input, withModel("ben", null))).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  })
})

test("a failing model call gives the client a clean error and puts no prompt or profile text in the logs", async () => {
  const pii = "ben-secret@test.dev 1 month"
  const failure = new APICallError({
    message: `bad request ${pii}`,
    url: "https://api.groq.com",
    requestBodyValues: { messages: [{ content: pii }] },
    statusCode: 500,
    responseBody: pii,
    responseHeaders: { "x-request-id": "req_42" },
    isRetryable: false,
  })
  const logged = spyOn(console, "error").mockImplementation(() => {})
  try {
    const error = await call(
      appRouter.ai.mapFields,
      { fields: [{ id: "f1", label: "Notice period" }] },
      withModel("ben", mockModel(failure)),
    ).catch((e) => e)
    expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "The AI is unavailable, try again." })
    const lines = inspect(logged.mock.calls, { depth: 10 })
    expect(lines).toContain("req_42")
    for (const secret of ["ben-secret", "1 month", "Notice period"]) expect(lines + error.message).not.toContain(secret)
  } finally {
    logged.mockRestore()
  }
})

test("a prompt that is too large for the model is a clean 400 and the model is never called", async () => {
  const model = mockModel(mapReply)
  const fields = Array.from({ length: 5 }, (_, i) => ({
    id: `f${i}`,
    label: "<".repeat(300),
    options: Array(50).fill("<".repeat(100)),
  }))
  await expect(call(appRouter.ai.mapFields, { fields }, withModel("ben", model))).rejects.toMatchObject({
    code: "BAD_REQUEST",
  })
  expect(model.doGenerateCalls.length).toBe(0)
})

const DAY = 24 * 60 * 60 * 1000

async function mint(owner: () => { context: Context }, expiresInDays: number | null = 30) {
  return call(appRouter.tokens.create, { name: "laptop", expiresInDays }, owner())
}

/** A router client, not `call`: the allowlist is keyed on the procedure path, which only a router client sets. */
async function asToken(secret: string, now = NOW) {
  const context = await createContext(
    { db, now: () => now } as never,
    new Headers({ authorization: `Bearer ${secret}` }),
  )
  return createRouterClient(appRouter, { context })
}

test("a token's secret is returned once and only its hash is stored", async () => {
  const created = await mint(ana)
  expect(created.secret).toStartWith("skp_")
  expect(created.prefix).toBe(created.secret.slice(0, 8))
  expect(created.last4).toBe(created.secret.slice(-4))

  const listed = await call(appRouter.tokens.list, undefined, ana())
  expect(listed.find((t) => t.id === created.id)).toBeDefined()
  expect(JSON.stringify(listed)).not.toContain(created.secret)

  const [row] = await db.select().from(apiToken).where(eq(apiToken.id, created.id))
  expect(row?.tokenHash).toBe(hashToken(created.secret))
  expect(JSON.stringify(row)).not.toContain(created.secret)
})

test("a token works for the extension's procedures without cookies or csrf, and only sees its owner's data", async () => {
  await call(appRouter.answers.create, { rawLabel: "Token question one", value: "ana's" }, ana())
  await call(appRouter.answers.create, { rawLabel: "Token question two", value: "ben's" }, ben())
  const { secret } = await mint(ana)

  const rows = await (await asToken(secret)).answers.list({})
  expect(rows.map((r) => r.value)).toContain("ana's")
  expect(rows.map((r) => r.value)).not.toContain("ben's")

  const who = await (await asToken(secret)).extension.whoami()
  expect(who).toMatchObject({ user: { email: "ana@test.dev" }, token: { name: "laptop" } })
})

test("revoked, expired, unknown and malformed tokens all fail the same way", async () => {
  const revoked = await mint(ana)
  await call(appRouter.tokens.revoke, { id: revoked.id }, ana())
  const expired = await mint(ana, 1)
  const fresh = await mint(ana)
  const failures = await Promise.all(
    [
      [revoked.secret, NOW],
      [expired.secret, new Date(NOW.getTime() + 2 * DAY)],
      [`skp_${"a".repeat(43)}`, NOW],
      ["not-a-token", NOW],
      ["", NOW],
      [`${fresh.secret}x`, NOW],
    ].map(async ([secret, now]) => (await asToken(secret as string, now as Date)).profile.get().catch((e) => e)),
  )
  for (const error of failures)
    expect(error).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Unauthorized." })
})

test("a token reaches exactly the allowlisted procedures", async () => {
  const { secret } = await mint(ana)
  const paths: string[] = []
  const walk = (node: object, prefix: string[]) => {
    for (const [key, child] of Object.entries(node)) {
      if (child && typeof child === "object" && "~orpc" in child) paths.push([...prefix, key].join("."))
      else if (child && typeof child === "object") walk(child, [...prefix, key])
    }
  }
  walk(appRouter, [])
  for (const path of TOKEN_PROCEDURES) expect(paths).toContain(path)

  const blocked = paths.filter((path) => !path.startsWith("public.") && !TOKEN_PROCEDURES.has(path))
  expect(blocked).toContain("tokens.create")
  expect(blocked).toContain("me.update")
  for (const path of blocked) {
    const client: unknown = await asToken(secret)
    const procedure = path
      .split(".")
      .reduce((node, key) => (node as Record<string, unknown>)[key], client) as () => Promise<unknown>
    const error = await procedure().catch((e: unknown) => e)
    expect(error, path).toMatchObject({ code: "FORBIDDEN" })
  }
})

test("a token can record and look up corrections but not read the learning dashboard", async () => {
  const { secret } = await mint(ana)
  const client = await asToken(secret)
  const siteKey = "jobs.acme.dev"
  await client.learning.record({
    siteKey,
    events: [{ label: "Favorite color", type: "text", filledValue: "", finalValue: "green", source: "site" }],
  })
  const { matches } = await client.learning.lookup({
    siteKey,
    fields: [{ id: "f", label: "Favorite color", type: "text" }],
  })
  expect(matches[0]).toMatchObject({ source: "site", value: "green" })
  await expect(client.learning.stats({})).rejects.toMatchObject({ code: "FORBIDDEN" })
  await expect(client.learning.suggestions()).rejects.toMatchObject({ code: "FORBIDDEN" })
  await expect(client.learning.siteProfiles({})).rejects.toMatchObject({ code: "FORBIDDEN" })
  await expect(client.learning.forgetSite({ siteKey })).rejects.toMatchObject({ code: "FORBIDDEN" })
})

test("lastUsedAt is written at most once a minute", async () => {
  const { id, secret } = await mint(ana)
  const lastUsed = async () => (await db.select().from(apiToken).where(eq(apiToken.id, id)))[0]?.lastUsedAt
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)

  await (await asToken(secret, at(0))).extension.whoami()
  await (await asToken(secret, at(30))).extension.whoami()
  expect(await lastUsed()).toEqual(at(0))
  await (await asToken(secret, at(61))).extension.whoami()
  expect(await lastUsed()).toEqual(at(61))
})

test("a user can only revoke their own token", async () => {
  const { id } = await mint(ana)
  await expect(call(appRouter.tokens.revoke, { id }, ben())).rejects.toMatchObject({ code: "NOT_FOUND" })
})

async function addUser(id: string, extra: Partial<typeof user.$inferInsert> = {}) {
  const now = new Date()
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@test.dev`, emailVerified: true, createdAt: now, updatedAt: now, ...extra })
  return () => ({ context: as(id) })
}

test("a token name can't hold control or hidden characters, but keeps the joiners real scripts need", async () => {
  const owner = await addUser("names")
  const rejected = ["\u0000", "​", "‮", "‎", "﻿", "­", " ", " ", "󠁁", "", "͸", "\n", "\ud800"]
  for (const char of rejected) {
    const error = await call(appRouter.tokens.create, { name: `a${char}b`, expiresInDays: 30 }, owner()).catch((e) => e)
    expect(error, JSON.stringify(char)).toMatchObject({ code: "BAD_REQUEST" })
  }
  expect(errorMessage(await mintNamed(owner, "a\u0000b"))).toBe("The name can't contain control or hidden characters.")
  for (const name of ["Café 💻", "می‌خواهم", "👩‍💻"]) {
    expect((await call(appRouter.tokens.create, { name, expiresInDays: 30 }, owner())).name).toBe(name)
  }
  expect((await call(appRouter.tokens.create, { name: "  padded  ", expiresInDays: 30 }, owner())).name).toBe("padded")
})

const mintNamed = (owner: () => { context: Context }, name: string) =>
  call(appRouter.tokens.create, { name, expiresInDays: 30 }, owner()).catch((e) => e)

test("a user holds at most 20 active tokens, revoked and expired ones don't count", async () => {
  const owner = await addUser("capped")
  const ids: string[] = []
  for (let i = 0; i < 20; i++) ids.push((await mint(owner)).id)
  const error = await mint(owner).catch((e) => e)
  expect(error).toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("20 active tokens") })

  await call(appRouter.tokens.revoke, { id: ids[0]! }, owner())
  await mint(owner)
  await expect(mint(owner)).rejects.toMatchObject({ code: "BAD_REQUEST" })

  const later = { context: as("capped", new Date(NOW.getTime() + 60 * DAY)) }
  await mint(() => later, 1)
})

test("parallel creates can't get past the cap", async () => {
  const owner = await addUser("racer")
  const results = await Promise.all(Array.from({ length: 30 }, () => mint(owner).catch((e) => e)))
  expect(results.filter((r) => r.secret)).toHaveLength(20)
  expect(results.filter((r) => r.code === "BAD_REQUEST")).toHaveLength(10)
  const stored = await db.select().from(apiToken).where(eq(apiToken.userId, "racer"))
  expect(stored).toHaveLength(20)
})

const day = (n: number) => new Date(NOW.getTime() - n * DAY)
const tokenRow = (userId: string, i: number, extra: Partial<typeof apiToken.$inferInsert>) => ({
  userId,
  name: `t${i}`,
  prefix: "skp_xxxx",
  last4: "abcd",
  tokenHash: `hash-${userId}-${i}`,
  createdAt: day(1),
  ...extra,
})

test("the list drops tokens that were revoked or expired more than 30 days ago", async () => {
  const owner = await addUser("window")
  await db
    .insert(apiToken)
    .values([
      tokenRow("window", 1, { revokedAt: day(2) }),
      tokenRow("window", 2, { expiresAt: day(3) }),
      tokenRow("window", 3, { revokedAt: day(31), createdAt: day(40) }),
      tokenRow("window", 4, { expiresAt: day(31), createdAt: day(40) }),
    ])
  const live = await mint(owner)
  const names = (await call(appRouter.tokens.list, undefined, owner())).map((t) => t.name)
  expect(names.sort()).toEqual(["laptop", "t1", "t2"])
  expect(live.name).toBe("laptop")
})

test("the list holds 100 tokens at most and active ones come first, so a live token is never cut", async () => {
  const owner = await addUser("lister")
  // Older than every revoked row below, so only "active first" keeps it inside the 100.
  const old = await mint(() => ({ context: { ...as("lister", day(10)), now: () => day(10) } }), 90)
  await db.insert(apiToken).values(Array.from({ length: 105 }, (_, i) => tokenRow("lister", i, { revokedAt: day(2) })))
  const listed = await call(appRouter.tokens.list, undefined, owner())
  expect(listed).toHaveLength(100)
  expect(listed[0]?.id).toBe(old.id)
})

test("revoking twice is fine, and someone else's token stays not found", async () => {
  const { id } = await mint(ana)
  await call(appRouter.tokens.revoke, { id }, ana())
  const [first] = await db.select().from(apiToken).where(eq(apiToken.id, id))
  await expect(call(appRouter.tokens.revoke, { id }, ana())).resolves.toEqual({ ok: true })
  const [second] = await db.select().from(apiToken).where(eq(apiToken.id, id))
  expect(second?.revokedAt).toEqual(first?.revokedAt)
  await expect(call(appRouter.tokens.revoke, { id }, ben())).rejects.toMatchObject({ code: "NOT_FOUND" })
})

test("a token dies with its owner, and a ban only blocks it until the ban expires", async () => {
  const banned = await addUser("banned", { banned: true, banExpires: new Date(NOW.getTime() + DAY) })
  const gone = await addUser("gone")
  const { secret: bannedSecret } = await mint(banned)
  const { secret: goneSecret } = await mint(gone)

  const whoami = async (secret: string, now = NOW) => (await asToken(secret, now)).extension.whoami().catch((e) => e)
  expect(await whoami(bannedSecret)).toMatchObject({ code: "UNAUTHORIZED", status: 401 })
  expect(await whoami(bannedSecret, new Date(NOW.getTime() + 2 * DAY))).toMatchObject({ user: { name: "banned" } })

  await db.update(user).set({ banExpires: null }).where(eq(user.id, "banned"))
  expect(await whoami(bannedSecret, new Date(NOW.getTime() + 2 * DAY))).toMatchObject({ code: "UNAUTHORIZED" })

  await db.delete(user).where(eq(user.id, "gone"))
  expect(await whoami(goneSecret)).toMatchObject({ code: "UNAUTHORIZED", status: 401 })
})

test("only a well formed bearer header is a token, anything odd is the same 401", async () => {
  const { secret } = await mint(ana)
  const whoami = async (headers: Headers) =>
    createRouterClient(appRouter, { context: await createContext({ db, now: () => NOW } as never, headers) })
      .extension.whoami()
      .catch((e: unknown) => e)

  expect(await whoami(new Headers({ authorization: `bearer ${secret}` }))).toMatchObject({ user: { name: "ana" } })
  expect(await whoami(new Headers({ authorization: `Bearer    ${secret}  ` }))).toMatchObject({ user: { name: "ana" } })

  const twice = new Headers()
  twice.append("authorization", `Bearer ${secret}`)
  twice.append("authorization", `Bearer ${secret}`)
  for (const headers of [
    twice,
    new Headers({ authorization: "Bearer" }),
    new Headers({ authorization: `Bearer ${secret} x` }),
  ]) {
    expect(await whoami(headers)).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Unauthorized." })
  }
})

class PostgresError extends Error {}

/** A drizzle failure as the driver gives it: the statement and every param, including the token hash. */
function failure(cause: Error): Error {
  return Object.assign(
    new Error(
      "Failed query: insert into api_token (token_hash, prefix, last4) params: LEAKED-HASH,LEAKED-PREFIX,LEAKED-4",
    ),
    { params: ["LEAKED-HASH", "LEAKED-PREFIX", "LEAKED-4"], cause },
  )
}

function breakOn(method: "transaction" | "select", cause: Error): Db {
  return new Proxy(db, {
    get: (target, key, receiver) =>
      key === method
        ? () => {
            throw failure(cause)
          }
        : Reflect.get(target, key, receiver),
  })
}

test("a database error in a token path is logged as operation, code and error class only, never its params", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {})
  const causes: Array<[Error, string, string]> = [
    [
      Object.assign(new PostgresError("invalid byte sequence 0x00 LEAKED-HASH"), { code: "22021" }),
      "22021",
      "PostgresError",
    ],
    [new TypeError("Received an instance of Date LEAKED-HASH"), "TypeError", "TypeError"],
    [Object.assign(new Error("connect ECONNREFUSED LEAKED-HASH"), { code: "ECONNREFUSED" }), "ECONNREFUSED", "Error"],
  ]
  try {
    for (const [cause, code, causeName] of causes) {
      const create = await call(
        appRouter.tokens.create,
        { name: "x", expiresInDays: 30 },
        { context: { ...as("ana"), db: breakOn("transaction", cause) } },
      ).catch((e) => e)
      expect(create).toMatchObject({ name: "TokenStoreError", operation: "create", causeName })
      expect(create.code).toBe(cause instanceof TypeError ? undefined : code)

      const { secret } = await mint(ana)
      const context = await createContext(
        { db: breakOn("select", cause), now: () => NOW } as never,
        new Headers({ authorization: `Bearer ${secret}` }),
      )
      // A db failure is an outage (503), not a rejected token (401).
      const verify = await createRouterClient(appRouter, { context })
        .extension.whoami()
        .catch((e: Error) => e)
      expect(verify).toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 })

      const lines = inspect(logged.mock.calls, { depth: 10 })
      expect(lines).toContain(causeName)
      for (const text of [
        "LEAKED",
        secret,
        hashToken(secret),
        secret.slice(0, 8),
        "token_hash",
        "0x00",
        "instance of Date",
      ]) {
        expect(lines + create.message + String(verify)).not.toContain(text)
      }
    }
  } finally {
    logged.mockRestore()
  }
})
