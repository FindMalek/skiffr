import { beforeAll, expect, spyOn, test } from "bun:test"
import { inspect } from "node:util"
import { PGlite } from "@electric-sql/pglite"
import { call } from "@orpc/server"
import { mockModel } from "@skiffr/ai/testing"
import type { Session } from "@skiffr/auth"
import { type Db, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { APICallError } from "ai"
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
