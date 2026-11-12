import { afterAll, beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { call } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { answer, apiToken, application, type Db, fieldEvent, gmailAccount, job, jobSource, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb, strictDateSerializers } from "@skiffr/db/test-db"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Context } from "../context"
import { limitClassOf, TOKEN_PROCEDURES } from "../procedures"
import { appRouter } from "./index"

const DRIZZLE = new URL("../../../db/drizzle", import.meta.url).pathname
let db: Db
let drop: (() => Promise<void>) | undefined

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL
  if (url) {
    const test = await createTestDb(url)
    drop = test.drop
    db = test.db
  } else {
    const pg = drizzle(new PGlite({ extensions: { vector }, serializers: strictDateSerializers }), { schema })
    await migrate(pg, { migrationsFolder: DRIZZLE })
    db = pg as unknown as Db
  }
})

afterAll(async () => {
  await drop?.()
})

const NOW = new Date("2026-11-12T15:00:00Z")
const at = (iso: string) => new Date(iso)
const SECRET = "SECRET-VALUE-never-in-the-feed"

let counter = 0
async function newUser() {
  const id = `act${++counter}`
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@test.dev`, emailVerified: true, createdAt: NOW, updatedAt: NOW })
  const as = (now = NOW) => ({
    context: {
      db,
      now: () => now,
      session: { user: { id } } as Session,
      headers: new Headers({ "x-csrf-token": "orpc" }),
    } as unknown as Context,
  })
  return { id, as }
}
type Owner = Awaited<ReturnType<typeof newUser>>

const list = (owner: Owner, input: { since?: string; cursor?: string; limit?: number } = {}) =>
  call(appRouter.activity.list, input, owner.as())

async function addJob(owner: Owner, n: number, queuedAt: Date, extra: Partial<typeof job.$inferInsert> = {}) {
  const [row] = await db
    .insert(job)
    .values({
      userId: owner.id,
      url: `https://jobs.acme.dev/${owner.id}/${n}`,
      canonicalId: `${owner.id}-${n}`,
      title: `Role ${n}`,
      company: "Acme",
      source: "manual",
      queuedAt,
      createdAt: queuedAt,
      ...extra,
    })
    .returning()
  return row!
}

/** One row for every kind of event, all inside the window. */
async function seedEverything(owner: Owner) {
  const queued = await addJob(owner, 1, at("2026-11-12T10:15:00Z"), { source: "gmail:linkedin" })
  await addJob(owner, 2, at("2026-11-12T10:45:00Z"), { source: "gmail:linkedin" })
  const applied = await addJob(owner, 3, at("2026-11-10T10:00:00Z"), { status: "applied" })
  await db.insert(application).values({
    userId: owner.id,
    jobId: applied.id,
    ats: "greenhouse",
    appliedAt: at("2026-11-11T09:00:00Z"),
    respondedAt: at("2026-11-12T08:00:00Z"),
    interviewAt: at("2026-11-12T09:00:00Z"),
  })
  await db.insert(answer).values([
    {
      userId: owner.id,
      normalizedLabel: "new thing",
      rawLabel: "New thing",
      value: SECRET,
      source: "autofill",
      createdAt: at("2026-11-12T11:00:00Z"),
    },
    {
      userId: owner.id,
      normalizedLabel: "old thing",
      rawLabel: "Old thing",
      value: SECRET,
      source: "autofill",
      createdAt: at("2026-09-01T00:00:00Z"),
      lastCorrectedAt: at("2026-11-12T12:00:00Z"),
    },
  ])
  await db.insert(fieldEvent).values(
    [1, 2, 3].map((i) => ({
      userId: owner.id,
      siteKey: "boards.greenhouse.io",
      fingerprint: `f${i}`,
      normalizedLabel: `label ${i}`,
      rawLabel: `Label ${i}`,
      filledValue: SECRET,
      finalValue: SECRET,
      source: "profile" as const,
      outcome: "accepted" as const,
      createdAt: at(`2026-11-12T13:0${i}:00Z`),
    })),
  )
  await db.insert(gmailAccount).values({
    userId: owner.id,
    email: `${owner.id}@gmail.test`,
    refreshTokenEnc: SECRET,
    scopes: "x",
    status: "needs_reconnect",
    lastError: "auth",
    updatedAt: at("2026-11-12T14:00:00Z"),
  })
  await db.insert(jobSource).values({
    userId: owner.id,
    url: `https://careers.acme.dev/feed?token=${SECRET}`,
    label: "",
    status: "error",
    lastError: "blocked",
    lastCheckedAt: at("2026-11-12T14:30:00Z"),
  })
  await db.insert(apiToken).values({
    userId: owner.id,
    name: "laptop",
    prefix: "skp_",
    last4: "abcd",
    tokenHash: `hash-${owner.id}`,
    expiresAt: at("2026-11-12T14:45:00Z"),
  })
  return queued
}

test("a user with nothing gets an empty feed and no cursor", async () => {
  const feed = await list(await newUser())
  expect(feed).toEqual({ items: [], nextCursor: null, since: at("2026-10-13T15:00:00Z") })
})

test("one row per kind shows up newest first, counts only, and never a value or a secret", async () => {
  const ana = await newUser()
  const ben = await newUser()
  await seedEverything(ana)
  await seedEverything(ben)
  const feed = await list(ana)
  expect(feed.items.map((e) => e.kind)).toEqual([
    "token_expired",
    "source_failed",
    "gmail_failed",
    "fields_filled",
    "answer_corrected",
    "answer_learned",
    "jobs_queued",
    "application_stage",
    "application_stage",
    "job_applied",
    "jobs_queued",
  ])
  expect(feed.items.find((e) => e.kind === "jobs_queued")).toMatchObject({ source: "gmail:linkedin", count: 2 })
  expect(feed.items.find((e) => e.kind === "fields_filled")).toMatchObject({ site: "boards.greenhouse.io", count: 3 })
  expect(feed.items.filter((e) => e.kind === "application_stage").map((e) => e.stage)).toEqual([
    "interview",
    "responded",
  ])
  expect(feed.items.find((e) => e.kind === "source_failed")).toMatchObject({
    source: "careers.acme.dev",
    code: "blocked",
  })
  expect(feed.items.find((e) => e.kind === "gmail_failed")).toMatchObject({ code: "auth", needsReconnect: true })
  const text = JSON.stringify(feed)
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain("hash-")
  expect(text).not.toContain("@gmail.test")
  expect(new Set(feed.items.map((e) => e.id)).size).toBe(feed.items.length)
})

test("paging walks the same events as one big page, with no repeat or gap, at every size", async () => {
  const cy = await newUser()
  const times = ["2026-11-12T10:00:00Z", "2026-11-12T10:00:00Z", "2026-11-12T09:00:00Z"]
  for (const [i, queuedAt] of times.entries()) {
    const row = await addJob(cy, i, at(queuedAt), { source: `src-${i}`, status: "applied" })
    await db.insert(application).values({ userId: cy.id, jobId: row.id, ats: "x", appliedAt: at(queuedAt) })
  }
  await db.insert(answer).values(
    ["a", "b"].map((label) => ({
      userId: cy.id,
      normalizedLabel: label,
      rawLabel: label,
      value: "v",
      source: "autofill" as const,
      createdAt: at("2026-11-12T10:00:00Z"),
    })),
  )
  const all = (await list(cy, { limit: 100 })).items
  expect(all).toHaveLength(8)
  for (const limit of [1, 2, 3, 7, 8, 9]) {
    const seen: string[] = []
    let cursor: string | undefined
    for (let pages = 0; pages < 20; pages++) {
      const page = await list(cy, { limit, cursor })
      expect(page.items.length).toBeLessThanOrEqual(limit)
      seen.push(...page.items.map((e) => e.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen, `limit ${limit}`).toEqual(all.map((e) => e.id))
  }
  expect((await list(cy, { limit: 8 })).nextCursor).toBeNull()
  expect((await list(cy, { limit: 7 })).nextCursor).not.toBeNull()
})

test("since cuts the feed, and the window caps how far back it can reach", async () => {
  const dee = await newUser()
  await addJob(dee, 1, at("2026-11-12T10:00:00Z"))
  await addJob(dee, 2, at("2026-11-12T12:00:00Z"), { source: "later" })
  await addJob(dee, 3, at("2026-09-01T12:00:00Z"), { source: "ancient" })
  expect((await list(dee, { since: "2026-11-12T11:00:00Z" })).items).toMatchObject([{ source: "later" }])
  expect((await list(dee, { since: "2026-01-01T00:00:00Z" })).items.map((e) => e.kind)).toEqual([
    "jobs_queued",
    "jobs_queued",
  ])
  expect((await list(dee, { since: "2027-01-01T00:00:00Z" })).items).toEqual([])
})

test("bad input is refused: a cursor that is not ours, no limit above the cap, since that is not a date", async () => {
  const eve = await newUser()
  await expect(list(eve, { cursor: "not-a-cursor" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  const forged = Buffer.from(JSON.stringify({ at: "x", kind: 1 })).toString("base64url")
  await expect(list(eve, { cursor: forged })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  await expect(list(eve, { limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  await expect(list(eve, { limit: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  await expect(list(eve, { since: "yesterday" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
})

test("a cursor from another user shows only the asker's own rows", async () => {
  const fay = await newUser()
  const gus = await newUser()
  await addJob(fay, 1, at("2026-11-12T10:00:00Z"), { source: "fay" })
  await addJob(gus, 1, at("2026-11-12T11:00:00Z"), { source: "gus" })
  await addJob(gus, 2, at("2026-11-12T09:00:00Z"), { source: "gus-old" })
  const page = await list(gus, { limit: 1 })
  const theirs = await list(fay, { cursor: page.nextCursor! })
  expect(theirs.items).toMatchObject([{ source: "fay" }])
})

test("hostile text is neutralized and clipped, and html stays plain text", async () => {
  const hal = await newUser()
  const hostile = `Eng‮neer​ <img src=x onerror=alert(1)>\u0001${"x".repeat(500)}`
  await addJob(hal, 1, at("2026-11-12T10:00:00Z"), { source: hostile })
  const row = await addJob(hal, 2, at("2026-11-12T11:00:00Z"), { title: hostile, company: "⁦Evil⁩", status: "applied" })
  await db
    .insert(application)
    .values({ userId: hal.id, jobId: row.id, ats: "x", appliedAt: at("2026-11-12T11:00:00Z") })
  const { items } = await list(hal)
  const applied = items.find((e) => e.kind === "job_applied")
  const queued = items.filter((e) => e.kind === "jobs_queued").at(-1)
  expect(applied && "title" in applied && applied.title).toContain("[U+202E]")
  expect(applied && "title" in applied && applied.title).toContain("[U+200B]")
  expect(applied && "title" in applied && applied.title).toContain("[U+0001]")
  expect(applied && "company" in applied && applied.company).toBe("[U+2066]Evil[U+2069]")
  expect(applied && "title" in applied && applied.title.length).toBeLessThanOrEqual(121)
  expect(queued && "source" in queued && queued.source).toContain("<img")
  expect(queued && "source" in queued && queued.source.length).toBeLessThanOrEqual(121)
  for (const char of ["\u202e", "\u200b", "\u0001"]) expect(JSON.stringify(items).includes(char)).toBe(false)
})

test("a revoked or still valid token is not an event, an expired one is", async () => {
  const ivy = await newUser()
  const base = { userId: ivy.id, prefix: "skp_", last4: "abcd" }
  await db.insert(apiToken).values([
    {
      ...base,
      name: "revoked",
      tokenHash: "h1",
      expiresAt: at("2026-11-12T10:00:00Z"),
      revokedAt: at("2026-11-11T00:00:00Z"),
    },
    { ...base, name: "valid", tokenHash: "h2", expiresAt: at("2026-12-12T10:00:00Z") },
    { ...base, name: "expired", tokenHash: "h3", expiresAt: at("2026-11-12T10:00:00Z") },
  ])
  expect((await list(ivy)).items).toMatchObject([{ kind: "token_expired", name: "expired" }])
})

test("the feed is session only: a token is refused and nothing here is on the token list", async () => {
  const jo = await newUser()
  expect([...TOKEN_PROCEDURES].filter((path) => path.startsWith("activity."))).toEqual([])
  const bearer = {
    context: {
      db,
      now: () => NOW,
      session: null,
      headers: new Headers({ authorization: "Bearer skp_x" }),
      bearer: true,
      tokenUnavailable: false,
      token: { id: "t", name: "t", prefix: "skp_", last4: "xxxx", expiresAt: null, user: { id: jo.id } },
    } as unknown as Context,
  }
  await expect(call(appRouter.activity.list, {}, bearer)).rejects.toMatchObject({ code: "FORBIDDEN" })
  const noCsrf = { context: { ...jo.as().context, headers: new Headers() } as Context }
  await expect(call(appRouter.activity.list, {}, noCsrf)).rejects.toMatchObject({ code: "FORBIDDEN" })
  expect(limitClassOf("activity.list", "GET")).toBe("read")
})
