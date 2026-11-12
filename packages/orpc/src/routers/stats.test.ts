import { afterAll, beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { call, createRouterClient } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { type Db, fieldEvent, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb, strictDateSerializers } from "@skiffr/db/test-db"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { type Context, createContext } from "../context"
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

let counter = 0
async function newUser() {
  const id = `s${++counter}`
  const now = new Date()
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@test.dev`, emailVerified: true, createdAt: now, updatedAt: now })
  const as = (at: Date) => ({
    context: {
      db,
      now: () => at,
      session: { user: { id } } as Session,
      headers: new Headers({ "x-csrf-token": "orpc" }),
    } as unknown as Context,
  })
  return { id, as }
}

type Owner = Awaited<ReturnType<typeof newUser>>

/** Thursday. A 7 day range starts Friday 2026-11-06 00:00Z. */
const NOW = new Date("2026-11-12T15:00:00Z")
const FROM = new Date("2026-11-06T00:00:00Z")
const at = (iso: string) => new Date(iso)

let seq = 0
async function apply(
  owner: Owner,
  queuedAt: Date,
  appliedAt: Date,
  extra: { source?: string; title?: string; ats?: string; matchScore?: number } = {},
) {
  const n = ++seq
  const saved = await call(
    appRouter.jobs.create,
    {
      url: `https://jobs.acme.dev/${n}`,
      title: extra.title ?? `Role ${n}`,
      company: "Acme",
      source: extra.source ?? "manual",
    },
    owner.as(queuedAt),
  )
  return call(
    appRouter.applications.create,
    {
      jobId: saved.id,
      ats: extra.ats ?? "greenhouse",
      ...(extra.matchScore === undefined ? {} : { matchScore: extra.matchScore }),
    },
    owner.as(appliedAt),
  )
}

const queue = (owner: Owner, queuedAt: Date, source: string) =>
  call(
    appRouter.jobs.create,
    { url: `https://jobs.acme.dev/${++seq}`, title: "Role", company: "Acme", source },
    owner.as(queuedAt),
  )

const overview = (owner: Owner, days: 7 | 30 | 90 = 7) => call(appRouter.stats.overview, { days }, owner.as(NOW))

test("a user with no data gets zeros for every day, no rates and no median", async () => {
  const stats = await overview(await newUser())
  expect(stats.perDay).toHaveLength(7)
  expect(stats.perDay.every((d) => d.count === 0)).toBe(true)
  expect(stats).toMatchObject({
    from: "2026-11-06",
    to: "2026-11-12",
    jobs: { queued: 0, applied: 0, skipped: 0 },
    stages: { applied: 0, responded: 0, interview: 0, offer: 0 },
    bySource: [],
    otherSources: null,
    byAts: [],
    byRole: [],
    timeToApply: { count: 0, medianHours: null },
    autofill: { fields: 0, forms: 0, bySource: [] },
  })
  expect(stats.byMatch.map((b) => b.applied)).toEqual([0, 0, 0, 0])
})

test("every number matches the rows: days, weeks, funnel, sources, stages, ats, role, score and time to apply", async () => {
  const ana = await newUser()
  const a = await apply(ana, at("2026-11-06T08:00:00Z"), at("2026-11-06T20:00:00Z"), {
    source: "gmail",
    title: "Backend Engineer",
    matchScore: 90,
  })
  const b = await apply(ana, at("2026-11-08T10:00:00Z"), at("2026-11-10T10:00:00Z"), {
    source: "gmail",
    title: " backend engineer ",
    ats: "Lever",
    matchScore: 60,
  })
  await apply(ana, at("2026-11-09T10:00:00Z"), at("2026-11-10T11:00:00Z"), { source: "manual", ats: "lever" })
  await call(appRouter.applications.update, { id: a.id, status: "offer" }, ana.as(NOW))
  await call(appRouter.applications.update, { id: b.id, status: "responded" }, ana.as(NOW))
  const skipped = await queue(ana, at("2026-11-09T09:00:00Z"), "manual")
  await call(appRouter.jobs.update, { id: skipped.id, status: "skipped" }, ana.as(NOW))
  await queue(ana, at("2026-11-12T09:00:00Z"), "manual")

  const stats = await overview(ana)
  expect(stats.perDay.filter((d) => d.count).map((d) => [d.day, d.count])).toEqual([
    ["2026-11-06", 1],
    ["2026-11-10", 2],
  ])
  expect(stats.perWeek).toEqual([
    { week: "2026-11-02", count: 1 },
    { week: "2026-11-09", count: 2 },
  ])
  expect(stats.jobs).toEqual({ queued: 1, applied: 3, skipped: 1 })
  expect(stats.bySource).toEqual([
    { source: "manual", queued: 1, applied: 1, skipped: 1 },
    { source: "gmail", queued: 0, applied: 2, skipped: 0 },
  ])
  expect(stats.stages).toEqual({ applied: 3, responded: 2, interview: 1, offer: 1 })
  expect(stats.byAts).toEqual([
    { key: expect.stringMatching(/^lever$/i), applied: 2, responded: 1, interview: 0, offer: 0 },
    { key: "greenhouse", applied: 1, responded: 1, interview: 1, offer: 1 },
  ])
  expect(stats.byRole[0]).toMatchObject({ applied: 2, responded: 2, interview: 1, offer: 1 })
  expect(stats.byRole).toHaveLength(2)
  expect(stats.byMatch).toEqual([
    { key: "0-49", applied: 0, responded: 0, interview: 0, offer: 0 },
    { key: "50-69", applied: 1, responded: 1, interview: 0, offer: 0 },
    { key: "70-84", applied: 0, responded: 0, interview: 0, offer: 0 },
    { key: "85-100", applied: 1, responded: 1, interview: 1, offer: 1 },
    { key: "none", applied: 1, responded: 0, interview: 0, offer: 0 },
  ])
  expect(stats.timeToApply).toEqual({
    count: 3,
    medianHours: 25,
    buckets: [
      { key: "under 1 day", count: 1 },
      { key: "1 to 3 days", count: 2 },
      { key: "3 to 7 days", count: 0 },
      { key: "over 7 days", count: 0 },
    ],
  })
})

test("the range is whole UTC days: the first instant counts, the instant before does not, midnight starts a new day", async () => {
  const ana = await newUser()
  const early = at("2026-11-01T00:00:00Z")
  await apply(ana, early, new Date(FROM.getTime() - 1))
  await apply(ana, early, FROM)
  await apply(ana, early, at("2026-11-06T23:59:59.999Z"))
  await apply(ana, early, at("2026-11-07T00:00:00Z"))
  const stats = await overview(ana)
  expect(stats.perDay.slice(0, 3).map((d) => [d.day, d.count])).toEqual([
    ["2026-11-06", 2],
    ["2026-11-07", 1],
    ["2026-11-08", 0],
  ])
  expect(stats.stages.applied).toBe(3)
  expect(await overview(ana, 30).then((s) => s.stages.applied)).toBe(4)
})

test("another user's jobs, applications and field events never show up, and a token can't read stats", async () => {
  const ana = await newUser()
  const ben = await newUser()
  const theirs = await apply(ben, at("2026-11-09T10:00:00Z"), at("2026-11-10T10:00:00Z"), { matchScore: 80 })
  await db.insert(fieldEvent).values({
    userId: ben.id,
    applicationId: theirs.id,
    siteKey: "jobs.acme.dev",
    fingerprint: "f",
    normalizedLabel: "email",
    rawLabel: "Email",
    filledValue: "a",
    finalValue: "b",
    source: "profile",
    outcome: "corrected",
    createdAt: at("2026-11-10T10:05:00Z"),
  })
  const stats = await overview(ana)
  expect(stats.jobs).toEqual({ queued: 0, applied: 0, skipped: 0 })
  expect(stats.stages.applied).toBe(0)
  expect(stats.autofill.fields).toBe(0)
  expect((await overview(ben)).autofill).toMatchObject({ fields: 1, corrected: 1, forms: 1 })

  const { secret } = await call(appRouter.tokens.create, { name: "laptop", expiresInDays: 30 }, ana.as(NOW))
  const context = await createContext(
    { db, now: () => NOW } as never,
    new Headers({ authorization: `Bearer ${secret}` }),
  )
  await expect(createRouterClient(appRouter, { context }).stats.overview({ days: 7 })).rejects.toMatchObject({
    code: "FORBIDDEN",
  })
})

test("autofill counts what was filled, left alone, corrected and cleared, per source, within the range", async () => {
  const ana = await newUser()
  const app = await apply(ana, at("2026-11-09T10:00:00Z"), at("2026-11-10T10:00:00Z"))
  const event = (source: "profile" | "ai", outcome: "accepted" | "corrected" | "cleared", createdAt: string) => ({
    userId: ana.id,
    applicationId: app.id,
    siteKey: "jobs.acme.dev",
    fingerprint: "f",
    normalizedLabel: "q",
    rawLabel: "Q",
    filledValue: "a",
    finalValue: "a",
    source,
    outcome,
    createdAt: at(createdAt),
  })
  await db
    .insert(fieldEvent)
    .values([
      event("profile", "accepted", "2026-11-10T10:05:00Z"),
      event("profile", "accepted", "2026-11-10T10:05:00Z"),
      event("ai", "corrected", "2026-11-10T10:05:00Z"),
      event("ai", "cleared", "2026-11-10T10:05:00Z"),
      event("ai", "accepted", "2026-11-05T23:59:59Z"),
    ])
  expect((await overview(ana)).autofill).toEqual({
    fields: 4,
    accepted: 2,
    corrected: 1,
    cleared: 1,
    forms: 1,
    bySource: [
      { source: "profile", fields: 2, accepted: 2, corrected: 0, cleared: 0 },
      { source: "ai", fields: 2, accepted: 0, corrected: 1, cleared: 1 },
    ],
  })
})

test("sources past the eighth are summed into one row", async () => {
  const ana = await newUser()
  for (let i = 0; i < 10; i++) await queue(ana, at("2026-11-10T10:00:00Z"), `src-${i}`)
  await queue(ana, at("2026-11-10T11:00:00Z"), "src-0")
  const stats = await overview(ana)
  expect(stats.bySource).toHaveLength(8)
  expect(stats.bySource[0]).toMatchObject({ source: "src-0", queued: 2 })
  expect(stats.otherSources).toEqual({ queued: 2, applied: 0, skipped: 0 })
})
