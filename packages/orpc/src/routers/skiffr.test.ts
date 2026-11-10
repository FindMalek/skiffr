import { afterAll, beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { call } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { type Db, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb } from "@skiffr/db/test-db"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Context } from "../context"
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
  const pg = drizzle(new PGlite(), { schema })
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
  canonicalId: "acme:1",
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
  await expect(call(appRouter.jobSources.create, { url: "file:///etc/passwd" }, ana())).rejects.toMatchObject({
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
  await call(appRouter.jobs.create, { ...POSTING, canonicalId: "acme:page-1", url: "https://jobs.acme.dev/p1" }, ben())
  await call(appRouter.jobs.create, { ...POSTING, canonicalId: "acme:page-2", url: "https://jobs.acme.dev/p2" }, ben())
  expect(await call(appRouter.jobs.list, { limit: 1 }, ben())).toHaveLength(1)
  expect(await call(appRouter.jobs.list, { limit: 1, offset: 1 }, ben())).toHaveLength(1)
  await expect(call(appRouter.jobs.list, { limit: 501 }, ben())).rejects.toMatchObject({ code: "BAD_REQUEST" })
})

test("jobs can be queued or skipped by hand but never set to applied", async () => {
  const job = await call(
    appRouter.jobs.create,
    { ...POSTING, canonicalId: "acme:status", url: "https://jobs.acme.dev/s" },
    ana(),
  )
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
    { ...POSTING, canonicalId: "acme:2", url: "https://jobs.acme.dev/2", title: "Designer" },
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
  const job = await call(
    appRouter.jobs.create,
    { ...POSTING, canonicalId: "acme:3", url: "https://jobs.acme.dev/3" },
    ana(),
  )
  const app = await call(appRouter.applications.create, { jobId: job.id, ats: "lever" }, ana())
  await call(appRouter.applications.remove, { id: app.id }, ana())
  const [back] = (await call(appRouter.jobs.list, {}, ana())).filter((j) => j.id === job.id)
  expect(back?.status).toBe("queued")
})

test("a watched careers page is saved once however the url is written, and stamped when checked", async () => {
  const source = await call(appRouter.jobSources.create, { url: "https://Acme.dev/careers/#open" }, ana())
  expect(source).toMatchObject({ url: "https://acme.dev/careers", lastCheckedAt: null })
  expect((await call(appRouter.jobSources.create, { url: "https://acme.dev/careers" }, ana())).id).toBe(source.id)
  const checked = await call(appRouter.jobSources.markChecked, { id: source.id }, ana())
  expect(checked.lastCheckedAt).toEqual(NOW)
})

test("another user's rows are not found by any update or remove", async () => {
  const answer = await call(appRouter.answers.create, { rawLabel: "Own answer", value: "x" }, ana())
  const job = await call(
    appRouter.jobs.create,
    { ...POSTING, canonicalId: "acme:own", url: "https://jobs.acme.dev/own" },
    ana(),
  )
  const application = await call(appRouter.applications.create, { jobId: job.id, ats: "lever" }, ana())
  const source = await call(appRouter.jobSources.create, { url: "https://own.dev/careers" }, ana())
  const asBen = ben()
  const attempts: Array<() => Promise<unknown>> = [
    () => call(appRouter.answers.update, { id: answer.id, value: "y" }, asBen),
    () => call(appRouter.answers.recordUse, { id: answer.id }, asBen),
    () => call(appRouter.answers.remove, { id: answer.id }, asBen),
    () => call(appRouter.jobs.update, { id: job.id, status: "skipped" }, asBen),
    () => call(appRouter.jobs.remove, { id: job.id }, asBen),
    () => call(appRouter.applications.update, { id: application.id, status: "offer" }, asBen),
    () => call(appRouter.applications.remove, { id: application.id }, asBen),
    () => call(appRouter.jobSources.markChecked, { id: source.id }, asBen),
    () => call(appRouter.jobSources.remove, { id: source.id }, asBen),
  ]
  for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" })
})
