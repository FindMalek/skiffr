import { afterAll, beforeAll, expect, spyOn, test } from "bun:test"
import { inspect } from "node:util"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { call, createRouterClient } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { type Db, job, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb, strictDateSerializers } from "@skiffr/db/test-db"
import { eq } from "drizzle-orm"
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
/** A fresh user per test, so tests never see each other's jobs. */
async function newUser() {
  const id = `q${++counter}`
  const now = new Date()
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@test.dev`, emailVerified: true, createdAt: now, updatedAt: now })
  const as = (at = new Date()) => ({
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

const T0 = new Date("2026-11-10T10:00:00Z")
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000)

let seq = 0
function add(
  owner: Owner,
  extra: Partial<{ url: string; title: string; company: string; source: string }> = {},
  at = T0,
) {
  const n = ++seq
  return call(
    appRouter.jobs.create,
    { url: `https://jobs.acme.dev/${n}`, title: `Role ${n}`, company: "Acme", source: "manual", ...extra },
    owner.as(at),
  )
}

async function asToken(secret: string) {
  const context = await createContext(
    { db, now: () => T0 } as never,
    new Headers({ authorization: `Bearer ${secret}` }),
  )
  return createRouterClient(appRouter, { context })
}

test("the same job from two sources and two url spellings is one row, and a second user keeps their own", async () => {
  const ana = await newUser()
  const ben = await newUser()
  const first = await add(ana, {
    url: "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-3812345678/?trk=email&utm_source=x",
    source: "gmail",
  })
  const second = await add(ana, {
    url: "https://uk.linkedin.com/jobs/view/3812345678",
    title: "Other title",
    source: "extension",
  })
  expect(first.created).toBe(true)
  expect(second).toMatchObject({ id: first.id, created: false, source: "gmail", title: first.title })
  expect(first.canonicalId).toBe("linkedin:3812345678")
  expect(await call(appRouter.jobs.list, {}, ana.as())).toHaveLength(1)

  const theirs = await add(ben, { url: "https://www.linkedin.com/jobs/view/3812345678" })
  expect(theirs).toMatchObject({ created: true })
  expect(theirs.id).not.toBe(first.id)
})

test("a vendor link is stored as the vendor's clean link, and a hostile link can't take over a job's id", async () => {
  const ana = await newUser()
  const first = await add(ana, {
    url: "https://uk.linkedin.com/jobs/view/senior-3912345678/?trackingId=x&refId=y&mkt_tok=secret",
  })
  expect(first).toMatchObject({
    canonicalId: "linkedin:3912345678",
    url: "https://www.linkedin.com/jobs/view/3912345678",
  })

  const spoof = await add(ana, {
    url: "https://linkedin.com/safety/go?url=https%3A%2F%2Fevil.example&currentJobId=3912345679",
  })
  expect(spoof.canonicalId).toStartWith("url:")
  const lookalike = await add(ana, { url: "https://indeed.xyz/viewjob?jk=abcdef0123456789" })
  expect(lookalike.canonicalId).toStartWith("url:")
  const real = await add(ana, { url: "https://www.indeed.com/viewjob?jk=abcdef0123456789&from=email" })
  expect(real).toMatchObject({
    created: true,
    canonicalId: "indeed:abcdef0123456789",
    url: "https://www.indeed.com/viewjob?jk=abcdef0123456789",
  })
  expect(real.id).not.toBe(lookalike.id)

  const unknown = await add(ana, { url: "https://careers.example.com/#/job/1?x=1" })
  expect(unknown.url).toBe("https://careers.example.com/#/job/1?x=1")
  expect((await add(ana, { url: "https://careers.example.com/#/job/2" })).created).toBe(true)
  const long = await add(ana, { url: `https://jobs.acme.dev/${"a".repeat(1500)}?q=${"b".repeat(400)}` })
  expect(long.canonicalId).toMatch(/^url:[0-9a-f]{32}$/)
})

test("a client-sent canonical id is ignored: the server derives it from the url", async () => {
  const ana = await newUser()
  const sent = await call(
    appRouter.jobs.create,
    {
      url: "https://www.linkedin.com/jobs/view/3912345678",
      canonicalId: "mine:1",
      title: "T",
      company: "C",
      source: "manual",
    } as never,
    ana.as(),
  )
  expect(sent.canonicalId).toBe("linkedin:3912345678")
})

test("urls that are not plain http(s) links, and text with control characters, can't be stored", async () => {
  const ana = await newUser()
  const bad = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:x",
    "file:///etc/passwd",
    "https://google.com@evil.example.com/jobs/1",
    "http://localhost:3000/a",
    "https://foo.localhost/a",
    "https://printer.local/a",
    "http://svc.internal/a",
    "http://nas.lan/a",
    "http://box.home.arpa/a",
    "http://[::1]/a",
    "http://10.0.0.1/a",
    "https://example.com/\u0000x",
    "https://example.com/?q=\u0001",
  ]
  for (const url of bad) {
    await expect(add(ana, { url }), url).rejects.toMatchObject({ code: "BAD_REQUEST" })
  }
  await expect(add(ana, { title: "bad\u0000title" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  expect(await call(appRouter.jobs.list, {}, ana.as())).toEqual([])
})

test("next is the oldest queued job, never changes anything, and skips jobs that are skipped or applied", async () => {
  const ana = await newUser()
  expect(await call(appRouter.jobs.next, undefined, ana.as())).toBeNull()
  const newest = await add(ana, {}, minutes(30))
  const oldest = await add(ana, {}, minutes(0))
  const middle = await add(ana, {}, minutes(10))

  const [a, b] = await Promise.all([
    call(appRouter.jobs.next, undefined, ana.as()),
    call(appRouter.jobs.next, undefined, ana.as()),
  ])
  expect(a?.id).toBe(oldest.id)
  expect(b?.id).toBe(oldest.id)
  const [row] = await db.select().from(job).where(eq(job.id, oldest.id))
  expect(row).toMatchObject({ status: "queued", updatedAt: oldest.updatedAt })

  await call(appRouter.jobs.update, { id: oldest.id, status: "skipped" }, ana.as())
  expect((await call(appRouter.jobs.next, undefined, ana.as()))?.id).toBe(middle.id)
  await call(appRouter.applications.create, { jobId: middle.id, ats: "other" }, ana.as())
  expect((await call(appRouter.jobs.next, undefined, ana.as()))?.id).toBe(newest.id)
  await call(appRouter.jobs.update, { id: oldest.id, status: "queued" }, ana.as())
  expect((await call(appRouter.jobs.next, undefined, ana.as()))?.id).toBe(oldest.id)
})

test("jobs queued at the same moment come back in one fixed order", async () => {
  const ana = await newUser()
  const made = await Promise.all(Array.from({ length: 6 }, () => add(ana)))
  const ids = made.map((m) => m.id).sort()
  expect((await call(appRouter.jobs.next, undefined, ana.as()))?.id).toBe(ids[0])
  const oldest = await call(appRouter.jobs.list, { order: "oldest" }, ana.as())
  expect(oldest.map((j) => j.id)).toEqual(ids)
  const pages = [
    ...(await call(appRouter.jobs.list, { order: "oldest", limit: 4 }, ana.as())),
    ...(await call(appRouter.jobs.list, { order: "oldest", limit: 4, offset: 4 }, ana.as())),
  ]
  expect(pages.map((j) => j.id)).toEqual(ids)
})

test("a token can ask for the next job of its owner, and nothing else of the queue's new procedures", async () => {
  const ana = await newUser()
  const ben = await newUser()
  const mine = await add(ana, {}, minutes(5))
  await add(ben, {}, minutes(0))
  const { secret } = await call(appRouter.tokens.create, { name: "laptop", expiresInDays: 30 }, ana.as())
  const client = await asToken(secret)
  expect((await client.jobs.next())?.id).toBe(mine.id)
  await expect(client.jobs.counts()).rejects.toMatchObject({ code: "FORBIDDEN" })
  await expect(client.jobs.bulkRemove({ ids: [mine.id] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  await expect(client.jobs.bulkUpdate({ ids: [mine.id], status: "skipped" })).rejects.toMatchObject({
    code: "FORBIDDEN",
  })
})

test("the list filters by status, source and a literal search of company or title", async () => {
  const ana = await newUser()
  const a = await add(ana, { company: "Acme", title: "Backend 100% remote", source: "gmail" }, minutes(1))
  await add(ana, { company: "Globex", title: "Frontend", source: "manual" }, minutes(2))
  const c = await add(ana, { company: "Acme_Labs", title: "Designer", source: "manual" }, minutes(3))
  await call(appRouter.jobs.update, { id: c.id, status: "skipped" }, ana.as())

  const list = async (input: Parameters<(typeof appRouter.jobs.list)["~orpc"]["handler"]>[0]["input"]) =>
    (await call(appRouter.jobs.list, input, ana.as())).map((j) => j.title)
  expect(await list({ status: "skipped" })).toEqual(["Designer"])
  expect(await list({ source: "gmail" })).toEqual(["Backend 100% remote"])
  expect(await list({ q: "acme" })).toEqual(["Designer", "Backend 100% remote"])
  expect(await list({ q: "100%" })).toEqual(["Backend 100% remote"])
  expect(await list({ q: "%" })).toEqual(["Backend 100% remote"])
  expect(await list({ q: "_" })).toEqual(["Designer"])
  expect(await list({ q: "\\" })).toEqual([])
  expect(await list({ q: "acme", source: "manual", status: "skipped" })).toEqual(["Designer"])
  await expect(call(appRouter.jobs.list, { q: "x".repeat(101) }, ana.as())).rejects.toMatchObject({
    code: "BAD_REQUEST",
  })
  expect(a.id).toBeDefined()
})

test("counts are per status and per source, and only the caller's", async () => {
  const ana = await newUser()
  const ben = await newUser()
  const j1 = await add(ana, { source: "gmail" })
  await add(ana, { source: "gmail" })
  const j3 = await add(ana, { source: "manual" })
  await add(ben, { source: "extension" })
  await call(appRouter.applications.create, { jobId: j1.id, ats: "other" }, ana.as())
  await call(appRouter.jobs.update, { id: j3.id, status: "skipped" }, ana.as())
  expect(await call(appRouter.jobs.counts, undefined, ana.as())).toEqual({
    status: { queued: 1, applied: 1, skipped: 1 },
    sources: [
      { source: "gmail", count: 2 },
      { source: "manual", count: 1 },
    ],
  })
  expect(await call(appRouter.jobs.counts, undefined, (await newUser()).as())).toEqual({
    status: { queued: 0, applied: 0, skipped: 0 },
    sources: [],
  })
})

test("bulk skip and remove only touch the caller's jobs, and skip leaves applied jobs alone", async () => {
  const ana = await newUser()
  const ben = await newUser()
  const [one, two, applied] = [await add(ana), await add(ana), await add(ana)]
  const theirs = await add(ben)
  await call(appRouter.applications.create, { jobId: applied.id, ats: "other" }, ana.as())

  const ids = [one!.id, applied.id, theirs.id]
  expect(await call(appRouter.jobs.bulkUpdate, { ids, status: "skipped" }, ana.as())).toEqual({ count: 1 })
  const states = Object.fromEntries((await call(appRouter.jobs.list, {}, ana.as())).map((j) => [j.id, j.status]))
  expect(states).toMatchObject({ [one!.id]: "skipped", [two!.id]: "queued", [applied.id]: "applied" })
  expect((await call(appRouter.jobs.list, {}, ben.as()))[0]?.status).toBe("queued")

  expect(await call(appRouter.jobs.bulkRemove, { ids }, ana.as())).toEqual({ count: 2 })
  expect(await call(appRouter.jobs.list, {}, ben.as())).toHaveLength(1)
  await expect(call(appRouter.jobs.bulkRemove, { ids: [] }, ana.as())).rejects.toMatchObject({ code: "BAD_REQUEST" })
})

test("the queue procedures never log what a job says", async () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level))
  try {
    const ana = await newUser()
    const secret = "SECRET-TITLE-7f3a"
    const created = await add(ana, { title: secret, company: "SECRET-COMPANY" })
    await call(appRouter.jobs.next, undefined, ana.as())
    await call(appRouter.jobs.list, { q: "SECRET" }, ana.as())
    await call(appRouter.jobs.update, { id: created.id, status: "skipped" }, ana.as())
    await expect(add(ana, { url: "javascript:alert(1)", title: secret })).rejects.toBeDefined()
    expect(inspect(spies.map((s) => s.mock.calls))).not.toContain("SECRET")
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
})
