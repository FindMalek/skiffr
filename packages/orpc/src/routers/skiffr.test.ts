import { beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { call } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { type Db, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Context } from "../context"
import { appRouter } from "./index"

const NOW = new Date("2026-11-10T10:00:00Z")
let db: Db

beforeAll(async () => {
  const pg = drizzle(new PGlite(), { schema })
  await migrate(pg, { migrationsFolder: new URL("../../../db/drizzle", import.meta.url).pathname })
  db = pg as unknown as Db
  const now = new Date()
  await pg.insert(user).values(
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

/** Only the better-auth session is faked: it is the external boundary, everything else is the real router on a real (in-process) postgres. */
function as(userId: string, now = NOW): Context {
  const session = { user: { id: userId } } as Session
  return {
    db,
    now: () => now,
    session,
    headers: new Headers({ "x-csrf-token": "orpc" }),
  } as unknown as Context
}

test("saving an answer under a differently written label updates the same row", async () => {
  const first = await call(
    appRouter.answers.create,
    { rawLabel: "Years of experience?", value: "5" },
    { context: as("ana") },
  )
  const second = await call(
    appRouter.answers.create,
    { rawLabel: "  years of EXPERIENCE ", value: "6", source: "ai" },
    { context: as("ana") },
  )
  expect(second.id).toBe(first.id)
  expect(second.normalizedLabel).toBe("years of experience")
  expect(second).toMatchObject({ value: "6", source: "ai", rawLabel: "years of EXPERIENCE" })
  expect(await call(appRouter.answers.list, undefined, { context: as("ben") })).toEqual([])
})

test("recording a use counts a fill, and a correction only when the user changed it", async () => {
  const saved = await call(
    appRouter.answers.create,
    { rawLabel: "Preferred name", value: "Ana" },
    { context: as("ana") },
  )
  await call(appRouter.answers.recordUse, { id: saved.id }, { context: as("ana") })
  const row = await call(appRouter.answers.recordUse, { id: saved.id, corrected: true }, { context: as("ana") })
  expect(row).toMatchObject({ timesUsed: 2, timesCorrected: 1 })
  await expect(call(appRouter.answers.recordUse, { id: saved.id }, { context: as("ben") })).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
})

test("a profile is one per user, and extra fields are stored under normalized labels", async () => {
  await call(appRouter.profile.upsert, { data: { identity: { firstName: "Ben" } } }, { context: as("ben") })
  const row = await call(
    appRouter.profile.upsert,
    { data: { salary: { currency: "EUR", min: 60000, period: "year" } }, fields: { "Notice Period!": "1 month" } },
    { context: as("ben") },
  )
  expect(row.data.salary.min).toBe(60000)
  expect(row.data.identity).toEqual({})
  expect(row.fields).toEqual({ "notice period": "1 month" })
  expect(await call(appRouter.profile.get, undefined, { context: as("ana") })).toBeNull()
})

test("queueing the same posting twice returns the saved job, and other users can't touch it", async () => {
  const input = {
    url: "https://jobs.acme.dev/1",
    canonicalId: "acme:1",
    title: "Engineer",
    company: "Acme",
    source: "greenhouse",
  }
  const job = await call(appRouter.jobs.create, input, { context: as("ana") })
  const again = await call(appRouter.jobs.create, { ...input, title: "Changed" }, { context: as("ana") })
  expect(again).toMatchObject({ id: job.id, title: "Engineer", status: "queued" })
  await expect(
    call(appRouter.jobs.update, { id: job.id, status: "skipped" }, { context: as("ben") }),
  ).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
  expect(await call(appRouter.jobs.list, { status: "skipped" }, { context: as("ana") })).toEqual([])
})

test("applying marks the job applied, and each funnel stage is stamped once", async () => {
  const job = await call(
    appRouter.jobs.create,
    { url: "https://jobs.acme.dev/2", canonicalId: "acme:2", title: "Designer", company: "Acme", source: "lever" },
    { context: as("ana") },
  )
  const app = await call(
    appRouter.applications.create,
    { jobId: job.id, ats: "lever", matchScore: 82 },
    { context: as("ana") },
  )
  expect(app).toMatchObject({ status: "applied", matchScore: 82, respondedAt: null })
  const [applied] = await call(appRouter.jobs.list, { status: "applied" }, { context: as("ana") })
  expect(applied?.id).toBe(job.id)

  const later = new Date("2026-11-12T10:00:00Z")
  const responded = await call(
    appRouter.applications.update,
    { id: app.id, status: "responded" },
    { context: as("ana") },
  )
  const again = await call(
    appRouter.applications.update,
    { id: app.id, status: "responded" },
    { context: as("ana", later) },
  )
  expect(responded.respondedAt).toEqual(NOW)
  expect(again.respondedAt).toEqual(NOW)

  await expect(
    call(appRouter.applications.create, { jobId: job.id, ats: "lever" }, { context: as("ana") }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
  })
  await expect(
    call(appRouter.applications.create, { jobId: job.id, ats: "lever" }, { context: as("ben") }),
  ).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
})

test("a watched careers page is saved once and stamped when checked", async () => {
  const url = "https://acme.dev/careers"
  const source = await call(appRouter.jobSources.create, { url }, { context: as("ana") })
  expect(source.lastCheckedAt).toBeNull()
  expect((await call(appRouter.jobSources.create, { url }, { context: as("ana") })).id).toBe(source.id)
  const checked = await call(appRouter.jobSources.markChecked, { id: source.id }, { context: as("ana") })
  expect(checked.lastCheckedAt).toEqual(NOW)
})
