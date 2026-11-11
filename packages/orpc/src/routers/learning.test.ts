import { afterAll, beforeAll, expect, spyOn, test } from "bun:test"
import { inspect } from "node:util"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { call } from "@orpc/server"
import { mockEmbeddingModel } from "@skiffr/ai/testing"
import type { Session } from "@skiffr/auth"
import { EMBEDDING_DIMENSIONS } from "@skiffr/common/constants"
import { answer, application, type Db, fieldEvent, job, recordBatch, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb, strictDateSerializers } from "@skiffr/db/test-db"
import { APICallError } from "ai"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Context } from "../context"
import { appRouter } from "./index"

const DAY = 86_400_000
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

/** Question texts sit on a circle: the angle between two of them sets their cosine similarity. */
const ANGLES: Record<string, number> = {
  "notice period": 0,
  "how soon can you start": 10,
  "favorite color": 90,
  "answer p": 0,
  "answer q": 30,
  "query near p": 3,
  "query tied": 15,
  "query far": 120,
  "query close": 20,
  "query short": 24,
}

function vectorOf(text: string): number[] {
  const angle = ((ANGLES[text] ?? 90) * Math.PI) / 180
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  v[0] = Math.cos(angle)
  v[1] = Math.sin(angle)
  return v
}

const embedder = () => mockEmbeddingModel(vectorOf)

let counter = 0
/** A fresh user per test, so tests never see each other's answers. */
async function newUser() {
  const id = `u${++counter}`
  const now = new Date()
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@test.dev`, emailVerified: true, createdAt: now, updatedAt: now })
  return (extra: Partial<Context> = {}, at = new Date()) => ({
    context: {
      db,
      now: () => at,
      session: { user: { id } } as Session,
      headers: new Headers({ "x-csrf-token": "orpc" }),
      ...extra,
    } as unknown as Context,
    id,
  })
}

const SITE = "boards.greenhouse.io/acme"
const event = (label: string, filledValue: string, finalValue: string, extra: object = {}) => ({
  label,
  type: "text",
  filledValue,
  finalValue,
  source: "profile" as const,
  ...extra,
})
const record = (
  as: Awaited<ReturnType<typeof newUser>>,
  events: object[],
  extra: object = {},
  ctx: Partial<Context> = {},
) => call(appRouter.learning.record, { siteKey: SITE, events, ...extra } as never, as(ctx))
const lookup = (as: Awaited<ReturnType<typeof newUser>>, fields: object[], ctx: Partial<Context> = {}) =>
  call(appRouter.learning.lookup, { siteKey: SITE, fields } as never, as(ctx))
const field = (id: string, label: string, extra: object = {}) => ({ id, label, type: "text", ...extra })
const answerOf = async (userId: string, normalizedLabel: string) =>
  (
    await db
      .select()
      .from(answer)
      .where(and(eq(answer.userId, userId), eq(answer.normalizedLabel, normalizedLabel)))
  )[0]

test("lookup prefers the exact fingerprint, then the same label, then a similar question, then nothing", async () => {
  const as = await newUser()
  const model = embedder()
  const options = ["1 month", "2 weeks"]
  await record(
    as,
    [event("Notice period", "1 month", "2 weeks", { type: "select", options })],
    {},
    { embeddingModel: model },
  )

  const select = (id: string, label: string, options: string[]) => field(id, label, { type: "select", options })
  const { matches } = await lookup(
    as,
    [
      select("exact", "Notice period?", ["2 weeks", "1 month"]),
      select("label", "notice period", ["2 WEEKS", "3 months"]),
      select("similar", "How soon can you start", ["2 weeks", "now"]),
      select("none", "Favorite color", ["2 weeks"]),
    ],
    { embeddingModel: model },
  )
  const hit = { answerId: expect.any(String), timesUsed: 0, timesCorrected: 1 }
  expect(matches).toEqual([
    { fieldId: "exact", source: "exact", autofill: true, score: 1, value: "2 weeks", ...hit },
    { fieldId: "label", source: "label", autofill: true, score: 1, value: "2 WEEKS", ...hit },
    { fieldId: "similar", source: "similar", autofill: false, score: expect.any(Number), value: "2 weeks", ...hit },
    { fieldId: "none", source: "none" },
  ])
  const similar = matches[2]
  expect(similar && "score" in similar && similar.score).toBeGreaterThan(0.95)
})

test("a learned value only comes back for a field it fits: same kind of control and one of the options", async () => {
  const as = await newUser()
  const model = embedder()
  await record(
    as,
    [event("Notice period", "x", "A", { type: "select", options: ["A", "B"] })],
    {},
    { embeddingModel: model },
  )

  const asked = (extra: object, label = "Notice period") =>
    lookup(as, [field("f", label, extra)], { embeddingModel: model })
  const source = async (extra: object, label?: string) => (await asked(extra, label)).matches[0]?.source
  expect(await source({ type: "select", options: ["C", "D"] })).toBe("none")
  expect(await source({ type: "checkbox" })).toBe("none")
  expect(await source({ type: "radio", options: ["Yes", "No"] })).toBe("none")
  expect(await source({ type: "text" })).toBe("none")
  expect(await source({ type: "select", options: ["a", "c"] })).toBe("label")
  expect(await source({ type: "select", options: ["C", "D"] }, "How soon can you start")).toBe("none")
  expect(await source({ type: "select", options: ["A", "B"] })).toBe("exact")
})

test("a similar question needs the threshold and a clear lead over the runner-up", async () => {
  const as = await newUser()
  const p = await call(appRouter.answers.create, { rawLabel: "Answer P", value: "P" }, as())
  const q = await call(appRouter.answers.create, { rawLabel: "Answer Q", value: "Q" }, as())
  for (const [id, label] of [
    [p.id, "answer p"],
    [q.id, "answer q"],
  ] as const) {
    await db
      .update(answer)
      .set({ embedding: vectorOf(label) })
      .where(eq(answer.id, id))
  }

  const { matches } = await lookup(
    as,
    [field("near", "Query near P"), field("tied", "Query tied"), field("far", "Query far")],
    { embeddingModel: embedder() },
  )
  expect(matches.map((m) => [m.fieldId, m.source])).toEqual([
    ["near", "similar"],
    ["tied", "none"],
    ["far", "none"],
  ])
  expect(matches[0]).toMatchObject({ value: "P", autofill: false })

  const alone = await newUser()
  const only = await call(appRouter.answers.create, { rawLabel: "Answer P", value: "P" }, alone())
  await db
    .update(answer)
    .set({ embedding: vectorOf("answer p") })
    .where(eq(answer.id, only.id))
  const { matches: floor } = await lookup(alone, [field("close", "Query close"), field("short", "Query short")], {
    embeddingModel: embedder(),
  })
  expect(floor.map((m) => m.source)).toEqual(["similar", "none"])
})

test("one user's answers never match another user's form, not even by similarity", async () => {
  const ana = await newUser()
  const ben = await newUser()
  const model = embedder()
  await record(ana, [event("Notice period", "1 month", "2 weeks")], {}, { embeddingModel: model })

  const fields = [field("a", "Notice period"), field("b", "How soon can you start")]
  expect((await lookup(ben, fields, { embeddingModel: model })).matches.map((m) => m.source)).toEqual(["none", "none"])
  expect((await lookup(ana, fields, { embeddingModel: model })).matches.map((m) => m.source)).toEqual([
    "exact",
    "similar",
  ])
})

test("concurrent records count every use and correction", async () => {
  const as = await newUser()
  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Ana" }, as())
  const results = await Promise.all([
    ...Array.from({ length: 8 }, () => record(as, [event("Preferred name", "Ana", "Ana")])),
    ...Array.from({ length: 4 }, () => record(as, [event("Preferred name", "Anna", "Ana")])),
  ])
  expect(results.every((r) => r.recorded === 1)).toBe(true)
  expect(await answerOf(as().id, "preferred name")).toMatchObject({ timesUsed: 8, timesCorrected: 4, value: "Ana" })
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toHaveLength(12)
})

test("a correction becomes the answer, embeds the question and not the value, and a later one updates it", async () => {
  const as = await newUser()
  const model = embedder()
  await record(as, [event("Notice period", "1 month", "secret-two-weeks")], {}, { embeddingModel: model })

  const first = await answerOf(as().id, "notice period")
  expect(first).toMatchObject({ value: "secret-two-weeks", source: "autofill", timesCorrected: 1, status: "learned" })
  expect(first?.embedding).toEqual(vectorOf("notice period"))
  expect(model.doEmbedCalls.map((c) => c.values)).toEqual([["notice period"]])

  await record(as, [event("Notice period", "secret-two-weeks", "immediately")], {}, { embeddingModel: model })
  expect(await answerOf(as().id, "notice period")).toMatchObject({
    id: first?.id,
    value: "immediately",
    timesUsed: 1,
    timesCorrected: 2,
  })
  expect(model.doEmbedCalls).toHaveLength(1)

  const [logged] = await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))
  expect(logged).toMatchObject({ siteKey: SITE, outcome: "corrected", source: "profile", filledValue: "1 month" })
})

test("an accepted value only counts for an answer that holds it, and a cleared one is never learned as empty", async () => {
  const as = await newUser()
  await call(appRouter.answers.create, { rawLabel: "Website", value: "ana.dev" }, as())
  const result = await record(as, [
    event("Website", "ana.dev", "ana.dev"),
    event("Website", "other.dev", "other.dev"),
    event("Linkedin", "in/ana", "in/ana"),
    event("Website", "ana.dev", "  "),
    event("Nickname", "Ana", ""),
  ])
  expect(result).toEqual({ recorded: 5, skipped: 0 })
  expect(await answerOf(as().id, "website")).toMatchObject({ value: "ana.dev", timesUsed: 2, timesCorrected: 1 })
  expect(await answerOf(as().id, "linkedin")).toBeUndefined()
  expect(await answerOf(as().id, "nickname")).toBeUndefined()
  expect(
    (await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).map((e) => e.outcome).sort(),
  ).toEqual(["accepted", "accepted", "accepted", "cleared", "cleared"])
})

test("password, hidden, file, payment, id and birth fields are never stored, logged or filled", async () => {
  const as = await newUser()
  const sensitive = [
    event("Password", "", "hunter2", { type: "password" }),
    event("Anything", "", "hunter2", { type: " Hid​den " }),
    event("Resume", "", "cv.pdf", { type: "file" }),
    event("Card number", "", "4111111111111111"),
    event("Social security number", "", "123-45-6789"),
    event("Date of birth", "", "1990-01-01"),
    event("Mystery", "", "hunter2", { type: "submit" }),
  ]
  expect(await record(as, [...sensitive, event("Nickname", "", "Ana")])).toEqual({ recorded: 1, skipped: 7 })
  expect(await db.select().from(answer).where(eq(answer.userId, as().id))).toHaveLength(1)
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toHaveLength(1)

  await call(appRouter.answers.create, { rawLabel: "Social security number", value: "123-45-6789" }, as())
  const { matches } = await lookup(as, [
    field("a", "Social security number"),
    field("b", "Nickname", { type: "password" }),
  ])
  expect(matches.map((m) => m.source)).toEqual(["none", "none"])
})

test("two identical corrections suggest keeping, and keeping stops the suggestion", async () => {
  const as = await newUser()
  await record(as, [event("Notice period", "1 month", "2 weeks")])
  expect(await call(appRouter.learning.suggestions, undefined, as())).toEqual([])
  await record(as, [event("Notice period", "1 month", "2 weeks")])

  const [suggestion] = await call(appRouter.learning.suggestions, undefined, as())
  expect(suggestion).toMatchObject({
    kind: "keep",
    count: 2,
    answer: { normalizedLabel: "notice period", value: "2 weeks" },
  })
  expect(Object.keys(suggestion!.answer)).not.toContain("userId")

  const kept = await call(
    appRouter.learning.resolveSuggestion,
    { answerId: suggestion!.answer.id, decision: "keep" },
    as(),
  )
  expect(kept.status).toBe("confirmed")
  expect(await call(appRouter.learning.suggestions, undefined, as())).toEqual([])
})

test("a value corrected to something new every time is flagged, and rejecting it stops it being filled", async () => {
  const as = await newUser()
  for (const value of ["50k", "60k", "70k"]) await record(as, [event("Salary", "x", value)])

  const [suggestion] = await call(appRouter.learning.suggestions, undefined, as())
  expect(suggestion).toMatchObject({ kind: "flip_flop", count: 3, answer: { normalizedLabel: "salary" } })

  const rejected = await call(
    appRouter.learning.resolveSuggestion,
    { answerId: suggestion!.answer.id, decision: "reject" },
    as(),
  )
  expect(rejected.status).toBe("rejected")
  expect(await call(appRouter.learning.suggestions, undefined, as())).toEqual([])
  expect((await lookup(as, [field("s", "Salary")])).matches[0]).toEqual({ fieldId: "s", source: "none" })
  await expect(
    call(
      appRouter.learning.resolveSuggestion,
      { answerId: suggestion!.answer.id, decision: "keep" },
      (await newUser())(),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" })
})

test("an answer nobody touched for half a year is suggested as stale", async () => {
  const as = await newUser()
  await call(appRouter.answers.create, { rawLabel: "Old answer", value: "x" }, as())
  expect(await call(appRouter.learning.suggestions, undefined, as())).toEqual([])
  const later = new Date(Date.now() + 200 * DAY)
  const [suggestion] = await call(appRouter.learning.suggestions, undefined, as({}, later))
  expect(suggestion).toMatchObject({ kind: "stale", answer: { normalizedLabel: "old answer" } })
})

test("stats count corrections per application, oldest first, and only for the owner", async () => {
  const as = await newUser()
  const ben = await newUser()
  const apply = async (n: number, appliedAt: Date) => {
    const [j] = await db
      .insert(job)
      .values({
        userId: as().id,
        url: `https://x.dev/${n}`,
        canonicalId: `x:${n}`,
        title: "T",
        company: "C",
        source: "s",
      })
      .returning()
    const [a] = await db
      .insert(application)
      .values({ userId: as().id, jobId: j!.id, ats: "lever", appliedAt })
      .returning()
    return a!.id
  }
  const older = await apply(1, new Date("2026-01-01T00:00:00Z"))
  const newer = await apply(2, new Date("2026-02-01T00:00:00Z"))
  await record(as, [event("A", "", "1"), event("B", "", "2"), event("C", "", "3"), event("D", "x", "x")], {
    applicationId: older,
  })
  await record(as, [event("A", "1", "1"), event("B", "2", "2"), event("C", "3", "3"), event("D", "x", "y")], {
    applicationId: newer,
  })
  await record(as, [event("E", "", "5")])

  const { applications } = await call(appRouter.learning.stats, {}, as())
  expect(applications.map((a) => [a.applicationId, a.fields, a.corrections, a.correctionsPerField])).toEqual([
    [older, 4, 3, 0.75],
    [newer, 4, 1, 0.25],
  ])
  expect((await call(appRouter.learning.stats, {}, ben())).applications).toEqual([])
  await expect(record(ben, [event("A", "", "1")], { applicationId: older })).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
})

test("without an embedding model nothing throws: answers are saved unembedded and lookup skips the similarity step", async () => {
  const as = await newUser()
  await record(as, [event("Notice period", "1 month", "2 weeks")])
  expect((await answerOf(as().id, "notice period"))?.embedding).toBeNull()

  const { matches } = await lookup(as, [field("a", "Notice period"), field("b", "How soon can you start")])
  expect(matches.map((m) => m.source)).toEqual(["exact", "none"])
})

test("a failing embedding provider degrades lookup and record, and puts no label or value in the logs", async () => {
  const as = await newUser()
  const pii = "zebra-label zebra-value"
  const failing = mockEmbeddingModel(
    new APICallError({
      message: `bad request ${pii}`,
      url: "https://api.openai.com",
      requestBodyValues: { input: [pii] },
      statusCode: 500,
      responseBody: pii,
      responseHeaders: { "x-request-id": "req_7" },
      isRetryable: false,
    }),
  )
  const logged = spyOn(console, "error").mockImplementation(() => {})
  try {
    await record(as, [event("Zebra label", "x", "zebra-value")], {}, { embeddingModel: failing })
    const saved = await answerOf(as().id, "zebra label")
    expect(saved).toMatchObject({ value: "zebra-value" })
    expect(saved?.embedding).toBeNull()

    const { matches } = await lookup(as, [field("a", "Zebra label"), field("b", "Other zebra label")], {
      embeddingModel: failing,
    })
    expect(matches.map((m) => m.source)).toEqual(["exact", "none"])

    const lines = inspect(logged.mock.calls, { depth: 10 })
    expect(lines).toContain("req_7")
    for (const text of ["zebra-label", "zebra-value", "Zebra label", "zebra label"]) expect(lines).not.toContain(text)
  } finally {
    logged.mockRestore()
  }
})

test("oversized or malformed requests are rejected before anything is read", async () => {
  const as = await newUser()
  const many = Array.from({ length: 61 }, (_, i) => field(`f${i}`, "Label"))
  const big = Array.from({ length: 25 }, (_, i) =>
    field(`f${i}`, "x".repeat(300), { options: Array(50).fill("y".repeat(100)) }),
  )
  const call_ = (input: object) => call(appRouter.learning.lookup, input as never, as()).catch((e) => e)
  expect(await call_({ siteKey: SITE, fields: many })).toMatchObject({ code: "BAD_REQUEST" })
  expect(await call_({ siteKey: SITE, fields: [field("a", "L"), field("a", "M")] })).toMatchObject({
    code: "BAD_REQUEST",
  })
  expect(await call_({ siteKey: "https://evil.dev/a b", fields: [field("a", "L")] })).toMatchObject({
    code: "BAD_REQUEST",
  })
  expect(await call_({ siteKey: SITE, fields: big })).toMatchObject({ code: "BAD_REQUEST" })
  expect(await record(as, [event("Label", "", "x".repeat(2001))]).catch((e) => e)).toMatchObject({
    code: "BAD_REQUEST",
  })
})

const corrections = async (as: Awaited<ReturnType<typeof newUser>>, values: string[], label = "Salary") => {
  for (const value of values) await record(as, [event(label, "other", value)])
}
const suggested = async (as: Awaited<ReturnType<typeof newUser>>) =>
  (await call(appRouter.learning.suggestions, undefined, as())).map((s) => [s.kind, s.count])

test("flip-flopping between values is flagged, a stable value is kept, and a settled switch asks nothing", async () => {
  const bouncing = await newUser()
  await corrections(bouncing, ["a", "b", "a", "b"])
  expect(await suggested(bouncing)).toEqual([["flip_flop", 4]])

  const same = await newUser()
  await corrections(same, ["a", "a"])
  expect(await suggested(same)).toEqual([["keep", 2]])

  const switched = await newUser()
  await corrections(switched, ["a", "b", "b", "b"])
  expect(await suggested(switched)).toEqual([])
})

test("clearing a filled value three times in a row stops it being auto filled and is suggested, an accept starts over", async () => {
  const as = await newUser()
  await record(as, [event("Nickname", "x", "Ana"), event("Website", "x", "ana.dev")])
  const clear = (label: string) => record(as, [event(label, label === "Nickname" ? "Ana" : "ana.dev", "")])
  const accept = (label: string) => record(as, [event(label, "ana.dev", "ana.dev")])
  const autofill = async () =>
    (await lookup(as, [field("n", "Nickname"), field("w", "Website")])).matches.map(
      (m) => "autofill" in m && m.autofill,
    )

  await clear("Nickname")
  await clear("Nickname")
  expect(await autofill()).toEqual([true, true])
  await clear("Nickname")
  await clear("Website")
  await clear("Website")
  await accept("Website")
  await clear("Website")
  expect(await autofill()).toEqual([false, true])
  expect(await suggested(as)).toContainEqual(["cleared", 3])

  const [clearing] = (await call(appRouter.learning.suggestions, undefined, as())).filter((s) => s.kind === "cleared")
  await call(appRouter.learning.resolveSuggestion, { answerId: clearing!.answer.id, decision: "keep" }, as())
  expect(await autofill()).toEqual([true, true])
})

test("stale answers cannot push flip-flops out of the suggestions", async () => {
  const as = await newUser()
  const old = new Date(Date.now() - 400 * DAY)
  await db.insert(answer).values(
    Array.from({ length: 100 }, (_, i) => ({
      userId: as().id,
      normalizedLabel: `old ${String(i).padStart(3, "0")}`,
      rawLabel: `old ${i}`,
      value: "x",
      updatedAt: old,
    })),
  )
  await corrections(as, ["a", "b", "a", "b"], "Zzz salary")
  const [first] = await call(appRouter.learning.suggestions, undefined, as())
  expect(first).toMatchObject({ kind: "flip_flop", answer: { normalizedLabel: "zzz salary" } })
})

test("a retried batch changes nothing the second time, even when the retries overlap", async () => {
  const as = await newUser()
  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Ana" }, as())
  const batchId = crypto.randomUUID()
  const send = (id: string) => record(as, [event("Preferred name", "Ana", "Ana")], { batchId: id })
  const results = await Promise.all([send(batchId), send(batchId), send(batchId)])
  expect(results).toEqual([
    { recorded: 1, skipped: 0 },
    { recorded: 1, skipped: 0 },
    { recorded: 1, skipped: 0 },
  ])
  expect(await answerOf(as().id, "preferred name")).toMatchObject({ timesUsed: 1 })
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toHaveLength(1)

  await send(crypto.randomUUID())
  expect(await answerOf(as().id, "preferred name")).toMatchObject({ timesUsed: 2 })
})

test("two records that touch the same labels in opposite order both finish and count everything", async () => {
  const as = await newUser()
  for (const [label, value] of Object.entries({ Alpha: "1", Beta: "2" })) {
    await call(appRouter.answers.create, { rawLabel: label, value }, as())
  }
  const both = (a: string, b: string) => [
    event(a, a === "Alpha" ? "1" : "2", a === "Alpha" ? "1" : "2"),
    event(b, b === "Alpha" ? "1" : "2", b === "Alpha" ? "1" : "2"),
  ]
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => record(as, i % 2 ? both("Alpha", "Beta") : both("Beta", "Alpha"))),
  )
  expect(await answerOf(as().id, "alpha")).toMatchObject({ timesUsed: 20 })
  expect(await answerOf(as().id, "beta")).toMatchObject({ timesUsed: 20 })
})

test("events older than 90 days and spent batch ids are purged when the user records again", async () => {
  const as = await newUser()
  const old = new Date(Date.now() - 100 * DAY)
  await db.insert(fieldEvent).values({
    userId: as().id,
    siteKey: "x.dev",
    fingerprint: "f",
    normalizedLabel: "f",
    rawLabel: "f",
    filledValue: "",
    finalValue: "v",
    source: "site",
    outcome: "corrected",
    createdAt: old,
  })
  await db.insert(recordBatch).values({ userId: as().id, batchId: crypto.randomUUID(), createdAt: old })
  await record(as, [event("Nickname", "", "Ana")])
  expect(
    (await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).map((e) => e.normalizedLabel),
  ).toEqual(["nickname"])
  expect(await db.select().from(recordBatch).where(eq(recordBatch.userId, as().id))).toEqual([])
})

test("an answer bank holds at most 2000 answers, but existing labels can still change", async () => {
  const as = await newUser()
  await db.insert(answer).values(
    Array.from({ length: 2000 }, (_, i) => ({
      userId: as().id,
      normalizedLabel: `l${i}`,
      rawLabel: `l${i}`,
      value: "x",
    })),
  )
  await expect(call(appRouter.answers.create, { rawLabel: "One more", value: "x" }, as())).rejects.toMatchObject({
    code: "BAD_REQUEST",
  })
  await expect(record(as, [event("One more", "", "x")])).rejects.toMatchObject({ code: "BAD_REQUEST" })
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toEqual([])
  await call(appRouter.answers.create, { rawLabel: "L1", value: "y" }, as())
  await record(as, [event("L2", "x", "z")])
  expect(await answerOf(as().id, "l2")).toMatchObject({ value: "z" })
})

test("a long value is logged but never learned, and a long saved answer is not auto filled", async () => {
  const as = await newUser()
  const letter = "w".repeat(301)
  await record(as, [event("Cover letter", "", letter, { type: "textarea" })])
  expect(await answerOf(as().id, "cover letter")).toBeUndefined()
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toHaveLength(1)

  await call(appRouter.answers.create, { rawLabel: "About me", value: letter }, as())
  expect((await lookup(as, [field("a", "About me")])).matches[0]).toMatchObject({ source: "label", autofill: false })
})

test("manual answers are embedded too, so they match by similarity", async () => {
  const as = await newUser()
  const model = embedder()
  const saved = await call(
    appRouter.answers.create,
    { rawLabel: "Answer P", value: "P" },
    as({ embeddingModel: model }),
  )
  expect((await db.select({ e: answer.embedding }).from(answer).where(eq(answer.id, saved.id)))[0]?.e).toEqual(
    vectorOf("answer p"),
  )
  expect((await lookup(as, [field("q", "Query near P")], { embeddingModel: model })).matches[0]).toMatchObject({
    source: "similar",
    value: "P",
  })

  const nobody = await newUser()
  const unused = embedder()
  await lookup(nobody, [field("q", "Query near P")], { embeddingModel: unused })
  expect(unused.doEmbedCalls).toHaveLength(0)
})

test("a failing database write is logged by class and code only, never with the labels or values it carried", async () => {
  const as = await newUser()
  const pii = "zebra-label zebra-value"
  const driverError = () =>
    Object.assign(new Error(`Failed query: insert into "field_event" params: ${pii}`), {
      code: "22021",
      params: [pii],
      query: pii,
    })
  const broken = {
    transaction: async () => {
      throw driverError()
    },
    select: () => {
      throw driverError()
    },
  } as unknown as Db
  const logged = spyOn(console, "error").mockImplementation(() => {})
  try {
    const error = await record(as, [event("Zebra label", "x", "zebra-value")], {}, { db: broken }).catch((e) => e)
    expect(error.message).not.toContain("zebra")
    await call(appRouter.answers.list, undefined, as({ db: broken })).catch(() => {})
    const lines = inspect(logged.mock.calls, { depth: 10 })
    expect(lines).toContain("22021")
    expect(lines).toContain("LearningStoreError")
    for (const text of ["zebra", "Failed query", "params"]) expect(lines).not.toContain(text)
  } finally {
    logged.mockRestore()
  }
})

test("control characters and lone surrogates in page text are a 400, tabs and newlines are fine", async () => {
  const as = await newUser()
  const bad = ["a\u0000b", "a\u0001b", "a\u007fb", "a\ud800b"]
  for (const text of bad) {
    expect(await record(as, [event(text, "", "v")]).catch((e) => e), text).toMatchObject({ code: "BAD_REQUEST" })
    expect(await record(as, [event("Label", text, "v")]).catch((e) => e)).toMatchObject({ code: "BAD_REQUEST" })
    expect(await record(as, [event("Label", "", text)]).catch((e) => e)).toMatchObject({ code: "BAD_REQUEST" })
    expect(await lookup(as, [field("a", text)]).catch((e) => e)).toMatchObject({ code: "BAD_REQUEST" })
    expect(await lookup(as, [field("a", "L", { options: [text] })]).catch((e) => e)).toMatchObject({
      code: "BAD_REQUEST",
    })
  }
  expect(await record(as, [event("Notice\nperiod", "", "line one\n\tline two")])).toEqual({ recorded: 1, skipped: 0 })
})
