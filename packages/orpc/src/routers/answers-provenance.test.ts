import { afterAll, beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { call } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import type { AnswerOrigin } from "@skiffr/common/schemas"
import { answer, type Db, fieldEvent, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb, strictDateSerializers } from "@skiffr/db/test-db"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Context } from "../context"
import { limitClassOf, TOKEN_PROCEDURES } from "../procedures"
import { appRouter } from "./index"

const DRIZZLE = new URL("../../../db/drizzle", import.meta.url).pathname
let db: Db
let counted: { db: Db; statements: () => number } | undefined
let drop: (() => Promise<void>) | undefined

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL
  if (url) {
    const test = await createTestDb(url)
    drop = test.drop
    db = test.db
  } else {
    const client = new PGlite({ extensions: { vector }, serializers: strictDateSerializers })
    const pg = drizzle(client, { schema })
    await migrate(pg, { migrationsFolder: DRIZZLE })
    db = pg as unknown as Db
    let statements = 0
    const logged = drizzle(client, { schema, logger: { logQuery: () => void statements++ } })
    counted = { db: logged as unknown as Db, statements: () => statements }
  }
})

afterAll(async () => {
  await drop?.()
})

const NOW = new Date("2026-11-12T15:00:00Z")
const at = (iso: string) => new Date(iso)
const TYPED = "TYPED-BY-USER-never-returned"
const FILLED = "FILLED-by-skiffr-never-returned"

let counter = 0
async function newUser() {
  const id = `prov${++counter}`
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@test.dev`, emailVerified: true, createdAt: NOW, updatedAt: NOW })
  const as = (database: Db = db) => ({
    context: {
      db: database,
      now: () => NOW,
      session: { user: { id } } as Session,
      headers: new Headers({ "x-csrf-token": "orpc" }),
    } as unknown as Context,
  })
  return { id, as }
}
type Owner = Awaited<ReturnType<typeof newUser>>

const provenance = (owner: Owner, page: { limit?: number; offset?: number } = {}, database?: Db) =>
  call(appRouter.answers.provenance, page, owner.as(database))

const addAnswer = (owner: Owner, label: string, extra: Partial<typeof answer.$inferInsert> = {}) =>
  db
    .insert(answer)
    .values({ userId: owner.id, normalizedLabel: label, rawLabel: label, value: "kept value", ...extra })
    .returning({ id: answer.id })
    .then(([row]) => row!.id)

const addEvent = (owner: Owner, label: string, iso: string, extra: Partial<typeof fieldEvent.$inferInsert> = {}) =>
  db.insert(fieldEvent).values({
    userId: owner.id,
    siteKey: "boards.greenhouse.io",
    fingerprint: "f",
    normalizedLabel: label,
    rawLabel: label,
    filledValue: FILLED,
    finalValue: "kept value",
    source: "answer",
    outcome: "accepted",
    createdAt: at(iso),
    ...extra,
  })

test("a user with no answers gets an empty list", async () => {
  expect(await provenance(await newUser())).toEqual([])
})

test("an answer seen on two sites reports sites, forms, first seen, last used and counts, and one with no events reports none", async () => {
  const ana = await newUser()
  const seen = await addAnswer(ana, "salary", {
    source: "autofill",
    status: "learned",
    timesUsed: 4,
    timesCorrected: 1,
  })
  const quiet = await addAnswer(ana, "visa", { source: "manual", status: "confirmed" })
  await addEvent(ana, "salary", "2026-11-01T10:00:00Z", {
    siteKey: "jobs.lever.co/acme",
    outcome: "corrected",
    source: "profile",
  })
  await addEvent(ana, "salary", "2026-11-05T10:00:00Z")
  await addEvent(ana, "salary", "2026-11-06T10:00:00Z")
  await addEvent(ana, "salary", "2026-11-08T10:00:00Z", { siteKey: "jobs.lever.co/acme", source: "ai" })

  const rows = await provenance(ana)
  const byId = new Map(rows.map((r) => [r.id, r]))
  expect(byId.get(seen)).toMatchObject({
    origin: "learned",
    forms: 4,
    siteCount: 2,
    sites: [
      { site: "boards.greenhouse.io", forms: 2 },
      { site: "jobs.lever.co/acme", forms: 2 },
    ],
    firstSeenAt: at("2026-11-01T10:00:00Z"),
    firstSeenSite: "jobs.lever.co/acme",
    lastUsedAt: at("2026-11-06T10:00:00Z"),
    timesUsed: 4,
    timesCorrected: 1,
    timesCleared: 0,
  })
  expect(byId.get(quiet)).toEqual({
    id: quiet,
    origin: "manual",
    forms: 0,
    siteCount: 0,
    sites: [],
    firstSeenAt: null,
    firstSeenSite: null,
    lastUsedAt: null,
    timesUsed: 0,
    timesCorrected: 0,
    timesCleared: 0,
    conflict: null,
  })
})

test("origin follows the source and whether the user confirmed a learned answer", async () => {
  const bo = await newUser()
  const ids: Record<AnswerOrigin, string> = {
    learned: await addAnswer(bo, "a", { source: "autofill", status: "learned" }),
    confirmed: await addAnswer(bo, "b", { source: "autofill", status: "confirmed" }),
    manual: await addAnswer(bo, "c", { source: "manual", status: "confirmed" }),
    imported: await addAnswer(bo, "d", { source: "import", status: "confirmed" }),
    ai: await addAnswer(bo, "e", { source: "ai", status: "learned" }),
  }
  const rows = await provenance(bo)
  for (const [origin, id] of Object.entries(ids) as [AnswerOrigin, string][])
    expect(rows.find((r) => r.id === id)?.origin).toBe(origin)
})

test("a field the user typed over the answer is a conflict, counted by distinct values, and no value is returned", async () => {
  const cy = await newUser()
  const id = await addAnswer(cy, "notice period")
  await addEvent(cy, "notice period", "2026-11-02T10:00:00Z", { outcome: "corrected", finalValue: TYPED })
  await addEvent(cy, "notice period", "2026-11-03T10:00:00Z", { outcome: "corrected", finalValue: TYPED })
  await addEvent(cy, "notice period", "2026-11-04T10:00:00Z", {
    outcome: "corrected",
    finalValue: `${TYPED}-2`,
    siteKey: "jobs.lever.co/acme",
  })
  await addEvent(cy, "notice period", "2026-11-05T10:00:00Z", { outcome: "corrected", finalValue: "kept value" })
  await addEvent(cy, "notice period", "2026-11-06T10:00:00Z", { outcome: "cleared", finalValue: "" })
  const [row] = await provenance(cy)
  expect(row).toMatchObject({
    id,
    conflict: { values: 2, sites: ["boards.greenhouse.io", "jobs.lever.co/acme"], lastAt: at("2026-11-04T10:00:00Z") },
  })
  const json = JSON.stringify(row)
  for (const secret of [TYPED, FILLED, "kept value"]) expect(json).not.toContain(secret)
})

test("another user's events and answers never show up, even on the same question", async () => {
  const dee = await newUser()
  const eve = await newUser()
  await addAnswer(dee, "salary")
  await addAnswer(eve, "salary")
  await addAnswer(eve, "eve only")
  await addEvent(eve, "salary", "2026-11-05T10:00:00Z", {
    siteKey: "eve.example",
    outcome: "corrected",
    finalValue: TYPED,
  })
  const rows = await provenance(dee)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ forms: 0, sites: [], conflict: null })
  expect(JSON.stringify(rows)).not.toContain("eve.example")
})

test("a page is the same page as the answer list, at every boundary", async () => {
  const fay = await newUser()
  for (let i = 0; i < 7; i++) await addAnswer(fay, `question ${i}`)
  for (const [limit, offset] of [
    [3, 0],
    [3, 3],
    [3, 6],
    [3, 7],
    [7, 0],
    [1, 6],
    [500, 0],
  ] as const) {
    const listed = await call(appRouter.answers.list, { limit, offset }, fay.as())
    const rows = await provenance(fay, { limit, offset })
    expect(
      rows.map((r) => r.id),
      `${limit}/${offset}`,
    ).toEqual(listed.map((a) => a.id))
  }
  await expect(provenance(fay, { limit: 501 })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  await expect(provenance(fay, { offset: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" })
})

test("the number of statements stays at three however many answers and events the page holds", async () => {
  if (!counted) return
  const small = await newUser()
  const big = await newUser()
  await addAnswer(small, "one")
  await addEvent(small, "one", "2026-11-05T10:00:00Z")
  const rows = Array.from({ length: 120 }, (_, i) => ({
    userId: big.id,
    normalizedLabel: `q ${i}`,
    rawLabel: `q ${i}`,
    value: "v",
  }))
  await db.insert(answer).values(rows)
  await db.insert(fieldEvent).values(
    rows.flatMap((r, i) =>
      [0, 1, 2].map((site) => ({
        userId: big.id,
        siteKey: `site-${site}.example`,
        fingerprint: "f",
        normalizedLabel: r.normalizedLabel,
        rawLabel: r.rawLabel,
        filledValue: "a",
        finalValue: `b${i % 3}`,
        source: "answer" as const,
        outcome: "corrected" as const,
        createdAt: at(`2026-11-0${site + 1}T10:00:00Z`),
      })),
    ),
  )
  const statementsFor = async (owner: Owner, limit: number) => {
    const before = counted!.statements()
    const result = await provenance(owner, { limit }, counted!.db)
    return { used: counted!.statements() - before, result }
  }
  const one = await statementsFor(small, 500)
  const many = await statementsFor(big, 500)
  expect(many.result).toHaveLength(120)
  expect(many.result[0]).toMatchObject({ forms: 3, siteCount: 3 })
  expect([one.used, many.used]).toEqual([3, 3])
})

test("site text from a page is neutralized and clipped", async () => {
  const gus = await newUser()
  await addAnswer(gus, "salary")
  const hostile = `evil‮.example​/${"x".repeat(400)}`
  await addEvent(gus, "salary", "2026-11-05T10:00:00Z", { siteKey: hostile, outcome: "corrected", finalValue: TYPED })
  const [row] = await provenance(gus)
  for (const site of [row!.sites[0]!.site, row!.firstSeenSite!, row!.conflict!.sites[0]!]) {
    expect(site).toContain("[U+202E]")
    expect(site).toContain("[U+200B]")
    expect(site.length).toBeLessThanOrEqual(121)
  }
})

test("provenance is session only: a token is refused and it is not on the token list", async () => {
  const hal = await newUser()
  expect(TOKEN_PROCEDURES.has("answers.provenance")).toBe(false)
  const bearer = {
    context: {
      db,
      now: () => NOW,
      session: null,
      headers: new Headers({ authorization: "Bearer skp_x" }),
      bearer: true,
      tokenUnavailable: false,
      token: { id: "t", name: "t", prefix: "skp_", last4: "xxxx", expiresAt: null, user: { id: hal.id } },
    } as unknown as Context,
  }
  await expect(call(appRouter.answers.provenance, {}, bearer)).rejects.toMatchObject({ code: "FORBIDDEN" })
  const noCsrf = { context: { ...hal.as().context, headers: new Headers() } as Context }
  await expect(call(appRouter.answers.provenance, {}, noCsrf)).rejects.toMatchObject({ code: "FORBIDDEN" })
  expect(limitClassOf("answers.provenance", "GET")).toBe("read")
})
