import { afterAll, beforeAll, expect, spyOn, test } from "bun:test"
import { inspect } from "node:util"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { call, ORPCError } from "@orpc/server"
import { mockEmbeddingModel } from "@skiffr/ai/testing"
import type { Session } from "@skiffr/auth"
import { EMBEDDING_DIMENSIONS } from "@skiffr/common/constants"
import {
  answer,
  application,
  type Db,
  fieldEvent,
  job,
  profile,
  recordBatch,
  sensitiveVerdict,
  siteProfile,
  user,
} from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb, strictDateSerializers } from "@skiffr/db/test-db"
import { APICallError } from "ai"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Context } from "../context"
import { verdictKey } from "../lib/sensitive-verdicts"
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
/** Looks up on a site nothing was recorded on, so the answer bank is what answers; the site profile tests use `lookupAt`. */
const lookup = (as: Awaited<ReturnType<typeof newUser>>, fields: object[], ctx: Partial<Context> = {}) =>
  call(appRouter.learning.lookup, { siteKey: "careers.elsewhere.dev", fields } as never, as(ctx))
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
  expect(result).toMatchObject({ recorded: 5, skipped: 0 })
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
  expect(await record(as, [...sensitive, event("Nickname", "", "Ana")])).toMatchObject({ recorded: 1, skipped: 7 })
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
  expect(results).toMatchObject([
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
  await db
    .insert(recordBatch)
    .values({ userId: as().id, batchId: crypto.randomUUID(), payloadHash: "h", createdAt: old })
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
  expect(await record(as, [event("One more", "", "x")])).toMatchObject({ answers: { status: "bank_full", skipped: 1 } })
  expect(await answerOf(as().id, "one more")).toBeUndefined()
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toHaveLength(1)
  await call(appRouter.answers.create, { rawLabel: "L1", value: "y" }, as())
  expect(await record(as, [event("L2", "x", "z")])).toMatchObject({ answers: { status: "saved", skipped: 0 } })
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

test("a question the model called sensitive is neither learned nor looked up, unless the verdict is expired or from an older policy", async () => {
  const as = await newUser()
  const key = verdictKey({ label: "Zodiac sign" }) as string
  await db.insert(sensitiveVerdict).values({ key, category: "religion", policyVersion: 1 })
  try {
    await db
      .insert(answer)
      .values({ userId: as().id, normalizedLabel: "zodiac sign", rawLabel: "Zodiac sign", value: "Leo" })
    const result = await record(as, [event("Zodiac sign", "", "Leo"), event("Lucky colour", "", "green")])
    expect(result).toMatchObject({ recorded: 1, skipped: 1 })
    const { matches } = await lookup(as, [field("a", "Zodiac sign"), field("b", "Lucky colour")])
    expect(matches.map((m) => m.source)).toEqual(["none", "exact"])

    await db.update(sensitiveVerdict).set({ policyVersion: 0 })
    const { matches: after } = await lookup(as, [field("a", "Zodiac sign")])
    expect(after[0]?.source).toBe("label")
  } finally {
    await db.delete(sensitiveVerdict)
  }
})

const NEUTRAL = "Please select one"
const OPTION_ONLY: string[][] = [
  ["Latina", "Not Hispanic"],
  ["Prefer not to state", "Yes", "No"],
  ["Heterosexuell", "Bisexuell"],
  ["Tengo una discapacidad", "No"],
  ["Pas de reponse", "Oui", "Non"],
]

test("a neutral label whose answers give the question away is neither recorded nor looked up", async () => {
  const as = await newUser()
  for (const options of OPTION_ONLY) {
    const result = await record(as, [
      event(NEUTRAL, options[0] as string, options[0] as string, { type: "select", options }),
      event("Lucky colour", "", "green"),
    ])
    expect(result, options.join()).toMatchObject({ recorded: 1, skipped: 1 })
  }
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.finalValue, "Latina"))).toHaveLength(0)

  await db
    .insert(answer)
    .values({ userId: as().id, normalizedLabel: "please select one", rawLabel: NEUTRAL, value: "Latina" })
  const { matches } = await lookup(as, [field("a", NEUTRAL, { type: "select", options: OPTION_ONLY[0] })])
  expect(matches.map((m) => m.source)).toEqual(["none"])
})

const AGREE_LABELS = [
  "Agree (required)",
  "Agree & proceed",
  "Agree and submit",
  "Agree and apply",
  "Agree and accept",
  "Yes agree",
  "We agree",
  "Please agree",
  "Tick to agree",
  "Check to agree",
  "Agree/Disagree",
  "Agree here",
  "Agree below",
  "Agrees",
]

test("any checkbox with the word agree is neither recorded nor looked up, an agreed salary still is", async () => {
  const as = await newUser()
  const result = await record(
    as,
    AGREE_LABELS.map((label) => event(label, "", "true", { type: "checkbox" })),
  )
  expect(result).toMatchObject({ recorded: 0, skipped: AGREE_LABELS.length })
  for (const label of AGREE_LABELS) {
    await db
      .insert(answer)
      .values({ userId: as().id, normalizedLabel: label.toLowerCase(), rawLabel: label, value: "true" })
      .onConflictDoNothing()
  }
  const { matches } = await lookup(
    as,
    AGREE_LABELS.map((label, i) => field(`a${i}`, label, { type: "checkbox" })),
  )
  expect(matches.map((m) => m.source)).toEqual(AGREE_LABELS.map(() => "none"))
  expect((await record(as, [event("Agreed salary", "", "70k")])).recorded).toBe(1)
})

test("a lone consent is neither recorded nor looked up, in every spelling", async () => {
  const as = await newUser()
  const consents = ["Agree", "Agreed", "Agree *", "AGREE", "Agree and continue", "I do agree", "I agree"]
  for (const label of consents) {
    const result = await record(as, [
      event(label, "", "true", { type: "checkbox" }),
      event("Lucky colour", "", "green"),
    ])
    expect(result, label).toMatchObject({ recorded: 1, skipped: 1 })
    await db
      .insert(answer)
      .values({ userId: as().id, normalizedLabel: label.toLowerCase(), rawLabel: label, value: "true" })
      .onConflictDoNothing()
  }
  const { matches } = await lookup(
    as,
    consents.map((label, i) => field(`c${i}`, label, { type: "checkbox" })),
  )
  expect(matches.map((m) => m.source)).toEqual(consents.map(() => "none"))
  const ordinary = await record(as, [event("Agreed salary", "", "70k")])
  expect(ordinary.recorded).toBe(1)
})

const verdictAge = async (label: string, ageMs: number, extra: Partial<typeof sensitiveVerdict.$inferInsert> = {}) => {
  const key = verdictKey({ label }) as string
  await db
    .insert(sensitiveVerdict)
    .values({ key, category: "religion", policyVersion: 1, createdAt: new Date(Date.now() - ageMs), ...extra })
  return key
}

test("the answer bank marks a saved answer whose question the api would not fill any more, by its long lists too", async () => {
  const as = await newUser()
  for (const rawLabel of ["Zivildienst absolviert", "Notice period"]) {
    await db.insert(answer).values({ userId: as().id, normalizedLabel: rawLabel.toLowerCase(), rawLabel, value: "x" })
  }
  const rows = await call(appRouter.answers.list, undefined, as())
  expect(Object.fromEntries(rows.map((row) => [row.rawLabel, row.sensitive]))).toEqual({
    "Zivildienst absolviert": true,
    "Notice period": false,
  })
})

test("a remembered verdict counts for 90 days and not a day more", async () => {
  const as = await newUser()
  try {
    await verdictAge("Old question", 91 * DAY)
    await verdictAge("Almost old question", 89 * DAY)
    const result = await record(as, [event("Old question", "", "a"), event("Almost old question", "", "b")])
    expect(result).toMatchObject({ recorded: 1, skipped: 1 })
    const { matches } = await lookup(as, [field("a", "Old question"), field("b", "Almost old question")])
    expect(matches.map((m) => m.source)).toEqual(["exact", "none"])
  } finally {
    await db.delete(sensitiveVerdict)
  }
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
  expect(await record(as, [event("Notice\nperiod", "", "line one\n\tline two")])).toMatchObject({
    recorded: 1,
    skipped: 0,
  })
})

const choice = (id: string, label: string, options: string[], type = "select") => field(id, label, { type, options })

test("options that differ only by symbols are told apart, and ambiguous ones fill nothing", async () => {
  const as = await newUser()
  const langs = ["C", "C++", "C#"]
  const sizes = ["<5", ">5"]
  await record(as, [
    event("Language", "x", "C++", { type: "select", options: langs }),
    event("Team size", "x", ">5", { type: "select", options: sizes }),
    event("Tool", "x", "c", { type: "select", options: ["c", "d"] }),
  ])
  const { matches } = await lookup(as, [
    choice("a", "Language", ["C#", "C++", "C"]),
    choice("b", "Team size", sizes),
    choice("c", "Tool", ["C++", "C#"]),
    choice("d", "Language", ["c#", "C++ ", "Java"]),
  ])
  expect(matches.map((m) => ("value" in m ? m.value : m.source))).toEqual(["C++", ">5", "none", "C++"])
})

test("a choice fills a choice of any kind, text fills a choice that has the value, but a choice never fills free text", async () => {
  const as = await newUser()
  await record(as, [
    event("Country", "x", "Canada"),
    event("Region", "x", "EU", { type: "select", options: ["EU", "US"] }),
  ])
  const sources = async (fields: object[]) =>
    (await lookup(as, fields)).matches.map((m) => ("value" in m ? m.value : "none"))
  expect(
    await sources([choice("a", "Country", ["USA", "Canada"]), choice("b", "Country", ["USA", "Mexico"], "radio")]),
  ).toEqual(["Canada", "none"])
  expect(
    await sources([choice("a", "Region", ["US", "EU", "UK"], "radio"), choice("b", "Region", ["EU", "x"], "combobox")]),
  ).toEqual(["EU", "EU"])
  expect(await sources([field("a", "Region")])).toEqual(["none"])
})

test("free text only goes into a typed control when it looks right for it", async () => {
  const as = await newUser()
  await record(as, [event("Years of work", "x", "five years"), event("Team", "x", "5")])
  const values = async (type: string) =>
    (await lookup(as, [field("a", "Years of work", { type }), field("b", "Team", { type })])).matches.map((m) =>
      "value" in m ? m.value : "none",
    )
  expect(await values("number")).toEqual(["none", "5"])
  expect(await values("date")).toEqual(["none", "none"])
  expect(await values("text")).toEqual(["five years", "5"])

  await record(as, [event("Count", "x", "7", { type: "number" })])
  expect((await lookup(as, [field("a", "Count", { type: "text" })])).matches[0]).toMatchObject({ value: "7" })
})

test("values that look like a card number, an iban or an ssn are never recorded or filled, ordinary numbers are", async () => {
  const as = await newUser()
  const result = await record(as, [
    event("Favorite number", "", "4111 1111 1111 1111"),
    event("Reference", "", "GB82 WEST 1234 5698 7654 32"),
    event("Lucky", "", "123-45-6789"),
    event("Years of experience", "", "15"),
    event("Long number", "", "1234567812345678"),
  ])
  expect(result).toMatchObject({ recorded: 2, skipped: 3 })
  await db
    .insert(answer)
    .values({ userId: as().id, normalizedLabel: "serial", rawLabel: "Serial", value: "4111111111111111" })
  const { matches } = await lookup(as, [field("a", "Serial"), field("b", "Years of experience")])
  expect(matches.map((m) => m.source)).toEqual(["none", "exact"])
})

test("a failing write logs frames, constraint and table names and safe messages, never the error message or params", async () => {
  const as = await newUser()
  const secret = "zebra-secret"
  const boom = () =>
    Object.assign(new Error(`bad ${secret}\n    at fake (zebra.ts:1:1)`), {
      code: "23505",
      constraint_name: "answer_user_label_unique",
      table_name: "answer",
      detail: secret,
      params: [secret],
    })
  let selects = 0
  const broken = {
    transaction: async () => {
      throw boom()
    },
    // the first read (the remembered verdicts of the record call) works, the next ones fail
    select: () => {
      if (selects++ === 0) return { from: () => ({ where: async () => [] }) }
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: secret })
    },
  } as unknown as Db
  const logged = spyOn(console, "error").mockImplementation(() => {})
  try {
    await record(as, [event("Nickname", "", "Ana")], {}, { db: broken, requestId: "req-1" } as never).catch(() => {})
    await call(appRouter.answers.list, undefined, as({ db: broken, requestId: "req-2" } as never)).catch(() => {})
    const lines = inspect(logged.mock.calls, { depth: 10 })
    expect(lines).toContain("23505")
    expect(lines).toContain("req-1")
    expect(lines).toContain("req-2")
    expect(lines).toContain("INTERNAL_SERVER_ERROR")
    expect(lines).toContain("The learning store failed.")
    expect(lines).toMatch(/at .*learning/)
    for (const text of [secret, "zebra.ts", "detail", "params"]) expect(lines).not.toContain(text)

    logged.mockClear()
    const plain = {
      select: () => {
        throw boom()
      },
    } as unknown as Db
    await call(appRouter.answers.list, undefined, as({ db: plain } as never)).catch(() => {})
    const direct = inspect(logged.mock.calls, { depth: 10 })
    expect(direct).toContain("answer_user_label_unique")
    expect(direct).toContain("table: 'answer'")
    expect(direct).toContain("at ")
    for (const text of [secret, "zebra.ts"]) expect(direct).not.toContain(text)
  } finally {
    logged.mockRestore()
  }
})

test("suggestions also purge old events of a user who stopped recording", async () => {
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
  await db
    .insert(recordBatch)
    .values({ userId: as().id, batchId: crypto.randomUUID(), payloadHash: "h", createdAt: old })
  await call(appRouter.learning.suggestions, undefined, as())
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toEqual([])
  expect(await db.select().from(recordBatch).where(eq(recordBatch.userId, as().id))).toEqual([])
})

test("a batch id reused for different events is refused, the same events are a no-op", async () => {
  const as = await newUser()
  const batchId = crypto.randomUUID()
  expect(await record(as, [event("Nickname", "", "Ana")], { batchId })).toMatchObject({ recorded: 1, skipped: 0 })
  expect(await record(as, [event("Nickname", "", "Ana")], { batchId })).toMatchObject({ recorded: 1, skipped: 0 })
  await expect(record(as, [event("Nickname", "", "Bea"), event("Other", "", "x")], { batchId })).rejects.toMatchObject({
    code: "CONFLICT",
  })
  expect(await answerOf(as().id, "nickname")).toMatchObject({ value: "Ana", timesCorrected: 1 })
})

test("parallel creates at the cap can't all get in", async () => {
  const as = await newUser()
  await db.insert(answer).values(
    Array.from({ length: 1999 }, (_, i) => ({
      userId: as().id,
      normalizedLabel: `l${i}`,
      rawLabel: `l${i}`,
      value: "x",
    })),
  )
  const results = await Promise.all(
    ["One", "Two", "Three", "Four"].map((rawLabel) =>
      call(appRouter.answers.create, { rawLabel, value: "x" }, as()).catch((e) => e),
    ),
  )
  expect(results.filter((r) => r.code === "BAD_REQUEST")).toHaveLength(3)
  expect((await db.select().from(answer).where(eq(answer.userId, as().id))).length).toBe(2000)
})

test("many keep suggestions can't hide a flip-flop or a cleared answer", async () => {
  const as = await newUser()
  const labels = Array.from({ length: 60 }, (_, i) => `keep ${String(i).padStart(2, "0")}`)
  await db.insert(answer).values(
    labels.map((normalizedLabel) => ({
      userId: as().id,
      normalizedLabel,
      rawLabel: normalizedLabel,
      value: "v",
      timesCorrected: 2,
    })),
  )
  await db.insert(fieldEvent).values(
    labels.flatMap((normalizedLabel) =>
      [0, 1].map(() => ({
        userId: as().id,
        siteKey: "x.dev",
        fingerprint: normalizedLabel,
        normalizedLabel,
        rawLabel: normalizedLabel,
        filledValue: "o",
        finalValue: "v",
        source: "site" as const,
        outcome: "corrected" as const,
      })),
    ),
  )
  await corrections(as, ["a", "b", "a", "b"], "Zzz salary")
  await record(as, [event("Zzz nickname", "x", "Ana")])
  for (let i = 0; i < 3; i++) await record(as, [event("Zzz nickname", "Ana", "")])

  const kinds = (await call(appRouter.learning.suggestions, undefined, as())).map((s) => s.kind)
  expect(kinds).toContain("flip_flop")
  expect(kinds).toContain("cleared")
  expect(kinds.filter((k) => k === "keep").length).toBeLessThanOrEqual(50)
})

test("a confirmed answer stops auto filling after three clears in a row, like any other", async () => {
  const as = await newUser()
  await call(appRouter.answers.create, { rawLabel: "Nickname", value: "Ana" }, as())
  for (let i = 0; i < 3; i++) await record(as, [event("Nickname", "Ana", "")])
  expect((await lookup(as, [field("a", "Nickname")])).matches[0]).toMatchObject({ source: "label", autofill: false })
  expect(await suggested(as)).toContainEqual(["cleared", 3])
})

test("saving an answer by hand makes it the confirmed, untyped default again, and control characters are a 400", async () => {
  const as = await newUser()
  await record(as, [event("Region", "x", "EU", { type: "select", options: ["EU", "US"] })])
  const learned = await answerOf(as().id, "region")
  await call(appRouter.learning.resolveSuggestion, { answerId: learned!.id, decision: "reject" }, as())
  expect(
    (await lookup(as, [field("a", "Region", { type: "select", options: ["EU", "US"] })])).matches[0],
  ).toMatchObject({ source: "none" })

  await call(appRouter.answers.create, { rawLabel: "Region", value: "US" }, as())
  expect(await answerOf(as().id, "region")).toMatchObject({
    status: "confirmed",
    fingerprint: null,
    timesCleared: 0,
    value: "US",
  })
  expect((await lookup(as, [field("a", "Region")])).matches[0]).toMatchObject({ source: "label", value: "US" })

  await call(appRouter.answers.update, { id: learned!.id, value: "EU" }, as())
  expect(await answerOf(as().id, "region")).toMatchObject({ status: "confirmed", value: "EU" })
  for (const input of [
    { rawLabel: "a\u0000b", value: "x" },
    { rawLabel: "Label", value: "x\u0000" },
  ]) {
    await expect(call(appRouter.answers.create, input, as())).rejects.toMatchObject({ code: "BAD_REQUEST" })
  }
})

test("correcting a learned value to a long one drops the old short value instead of filling it again", async () => {
  const as = await newUser()
  await record(as, [event("Motivation", "x", "short", { type: "textarea" })])
  expect((await lookup(as, [field("a", "Motivation", { type: "textarea" })])).matches[0]).toMatchObject({
    value: "short",
  })
  await record(as, [event("Motivation", "short", "w".repeat(301), { type: "textarea" })])
  expect(await answerOf(as().id, "motivation")).toBeUndefined()
  expect((await lookup(as, [field("a", "Motivation", { type: "textarea" })])).matches[0]).toEqual({
    fieldId: "a",
    source: "none",
  })
})

const SITE_B = "jobs.lever.co/beta"
const atSite = (as: Awaited<ReturnType<typeof newUser>>, siteKey: string, events: object[], extra: object = {}) =>
  record(as, events, { siteKey, ...extra })
const lookupAt = (as: Awaited<ReturnType<typeof newUser>>, siteKey: string, fields: object[]) =>
  call(appRouter.learning.lookup, { siteKey, fields } as never, as())
const sitesOf = (userId: string) => db.select().from(siteProfile).where(eq(siteProfile.userId, userId))
const select = (id: string, label: string, options: string[]) => field(id, label, { type: "select", options })
const first = (matches: Awaited<ReturnType<typeof lookup>>["matches"]) => matches[0] as Record<string, unknown>

test("site entries come first with source site and beat the global answer for that field", async () => {
  const as = await newUser()
  await call(appRouter.answers.create, { rawLabel: "Notice period", value: "1 month" }, as())
  await call(appRouter.answers.create, { rawLabel: "Favorite color", value: "green" }, as())
  const options = ["1 month", "2 weeks"]
  await record(as, [
    event("Notice period", "1 month", "2 weeks", { type: "select", options }),
    event("Favorite color", "green", "green", { source: "answer" }),
  ])

  const { matches } = await lookupAt(as, SITE, [select("n", "Notice period", options), field("p", "Favorite color")])
  expect(matches).toMatchObject([
    { fieldId: "n", source: "site", value: "2 weeks", autofill: true },
    { fieldId: "p", source: "site", value: "green", autofill: true },
  ])
  const other = await lookupAt(as, SITE_B, [select("n", "Notice period", options)])
  expect(first(other.matches)).toMatchObject({ source: "label", value: "1 month" })
})

test("a correction on one site does not change what another site gets", async () => {
  const as = await newUser()
  const options = ["Remote", "Onsite"]
  const work = (filled: string, final: string) => event("Work mode", filled, final, { type: "select", options })
  await atSite(as, SITE_B, [work("", "Remote")])
  await atSite(as, SITE, [work("Remote", "Onsite")])

  expect(first((await lookupAt(as, SITE_B, [select("w", "Work mode", options)])).matches)).toMatchObject({
    source: "site",
    value: "Remote",
  })
  expect(first((await lookupAt(as, SITE, [select("w", "Work mode", options)])).matches)).toMatchObject({
    source: "site",
    value: "Onsite",
  })
  await atSite(as, SITE_B, [work("Remote", "Remote")])
  expect(await answerOf(as().id, "work mode")).toMatchObject({ value: "Onsite", timesCorrected: 2 })
})

test("a correction on a site never overwrites a global answer the user confirmed, but is logged and kept for that site", async () => {
  const as = await newUser()
  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Ana" }, as())
  await record(as, [event("Preferred name", "Ana", "Anita")])

  expect(await answerOf(as().id, "preferred name")).toMatchObject({
    value: "Ana",
    status: "confirmed",
    timesCorrected: 0,
  })
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toMatchObject([
    { outcome: "corrected", finalValue: "Anita" },
  ])
  expect(first((await lookupAt(as, SITE, [field("n", "Preferred name")])).matches)).toMatchObject({
    source: "site",
    value: "Anita",
  })
  expect(first((await lookupAt(as, SITE_B, [field("n", "Preferred name")])).matches)).toMatchObject({
    source: "label",
    value: "Ana",
  })
})

test("a form changed by one field still matches, a different form does not", async () => {
  const as = await newUser()
  const labels = ["Alpha one", "Beta two", "Gamma three", "Delta four", "Epsilon five"]
  await record(
    as,
    labels.map((label) => event(label, "", `${label} v`)),
  )
  await call(appRouter.answers.create, { rawLabel: "Zeta six", value: "global zeta" }, as())

  const form = (names: string[]) => names.map((label, i) => field(`f${i}`, label))
  const changed = await lookupAt(as, SITE, form([...labels.slice(0, 4), "Zeta six"]))
  expect(changed.matches.map((m) => m.source)).toEqual(["site", "site", "site", "site", "label"])

  const different = await lookupAt(as, SITE, form(["Alpha one", "Beta two", "Zeta six", "Eta seven", "Theta eight"]))
  expect(different.matches.map((m) => m.source)).toEqual(["exact", "exact", "label", "none", "none"])
})

test("password, card, hidden and long values never reach a site profile", async () => {
  const as = await newUser()
  await record(as, [
    event("Favorite color", "", "green"),
    event("Password", "", "hunter2", { type: "password" }),
    event("Card number", "", "4111 1111 1111 1111"),
    event("Account", "", "x", { autocomplete: "cc-number" }),
    event("Reference", "", "4111111111111111"),
    event("Secret file", "", "cv.pdf", { type: "file" }),
    event("About you", "", "x".repeat(301), { type: "textarea" }),
  ])
  const [saved] = await sitesOf(as().id)
  expect(Object.values(saved!.fieldMap).map((entry) => entry.label)).toEqual(["favorite color"])
  const stored = JSON.stringify(saved)
  for (const text of ["hunter2", "4111", "password", "card number", "cv.pdf", "xxxxxxxx"]) {
    expect(stored).not.toContain(text)
  }
})

test("clearing a site value three times stops the autofill for that site only, an accept starts over", async () => {
  const as = await newUser()
  await record(as, [event("Nickname", "", "Ana")])
  const clear = () => record(as, [event("Nickname", "Ana", "")])
  const autofill = async () => first((await lookupAt(as, SITE, [field("n", "Nickname")])).matches).autofill
  await clear()
  await clear()
  expect(await autofill()).toBe(true)
  await clear()
  expect(await autofill()).toBe(false)
  await record(as, [event("Nickname", "Ana", "Ana", { source: "site" })])
  expect(await autofill()).toBe(true)
})

test("entries copied from the profile or an answer are dropped once their source changes", async () => {
  const as = await newUser()
  await db.insert(profile).values({ userId: as().id, data: {} as never, updatedAt: new Date(Date.now() - DAY) })
  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Ana" }, as())
  await record(as, [
    event("Preferred name", "Ana", "Ana", { source: "answer" }),
    event("Email", "a@b.dev", "a@b.dev", { source: "profile" }),
    event("Favorite color", "x", "x", { source: "ai" }),
  ])
  const ask = () =>
    lookupAt(as, SITE, [field("n", "Preferred name"), field("e", "Email"), field("p", "Favorite color")])
  expect((await ask()).matches.map((m) => m.source)).toEqual(["site", "site", "site"])

  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Anita" }, as())
  await db
    .update(profile)
    .set({ updatedAt: new Date(Date.now() + DAY) })
    .where(eq(profile.userId, as().id))
  expect((await ask()).matches.map((m) => m.source)).toEqual(["label", "none", "site"])
})

test("the cap keeps 500 forms per user and drops the least recently used", async () => {
  const as = await newUser()
  const base = Date.now() - 400 * 60_000
  await db.insert(siteProfile).values(
    Array.from({ length: 500 }, (_, i) => ({
      userId: as().id,
      siteKey: `site${i}.dev`,
      formSignature: `sig${i}`,
      fieldKeys: [],
      fieldMap: {},
      lastUsedAt: new Date(base + i * 1_000),
    })),
  )
  await atSite(as, "new.dev", [event("Favorite color", "", "green")], {})
  const rows = await sitesOf(as().id)
  expect(rows).toHaveLength(500)
  expect(rows.map((r) => r.siteKey)).toContain("new.dev")
  expect(rows.map((r) => r.siteKey)).not.toContain("site0.dev")
  expect(rows.map((r) => r.siteKey)).toContain("site1.dev")
})

test("forms unused for 180 days are purged when the user records again, newer ones stay", async () => {
  const as = await newUser()
  const row = (siteKey: string, days: number) => ({
    userId: as().id,
    siteKey,
    formSignature: siteKey,
    fieldKeys: [],
    fieldMap: {},
    lastUsedAt: new Date(Date.now() - days * DAY),
  })
  await db.insert(siteProfile).values([row("old.dev", 200), row("recent.dev", 100)])
  await record(as, [event("Favorite color", "", "green")])
  expect((await sitesOf(as().id)).map((r) => r.siteKey).sort()).toEqual([SITE, "recent.dev"].sort())
})

test("parallel records of one form, with the fields in opposite order, finish and count every accept", async () => {
  const as = await newUser()
  const pair = (swap: boolean) => {
    const a = event("Alpha", "1", "1", { source: "ai" })
    const b = event("Beta", "2", "2", { source: "ai" })
    return swap ? [b, a] : [a, b]
  }
  await Promise.all(Array.from({ length: 20 }, (_, i) => record(as, pair(i % 2 === 0))))
  const rows = await sitesOf(as().id)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ timesUsed: 20 })
  expect(Object.values(rows[0]!.fieldMap).map((entry) => entry.timesUsed)).toEqual([20, 20])
})

test("a retried batch counts once in the site profile too", async () => {
  const as = await newUser()
  const batchId = crypto.randomUUID()
  const send = () => record(as, [event("Alpha", "1", "1", { source: "ai" })], { batchId })
  await Promise.all([send(), send(), send()])
  expect(await sitesOf(as().id)).toMatchObject([{ timesUsed: 1 }])
})

test("site profiles are listed and forgotten per site, for their owner only", async () => {
  const as = await newUser()
  const other = await newUser()
  await atSite(as, SITE, [event("Favorite color", "", "green")])
  await atSite(as, SITE_B, [event("Favorite color", "", "blue")])
  await atSite(other, SITE, [event("Favorite color", "", "red")])

  const listed = await call(appRouter.learning.siteProfiles, { limit: 50 }, as())
  expect(listed.map((s) => s.siteKey).sort()).toEqual([SITE_B, SITE].sort())
  expect(listed.find((s) => s.siteKey === SITE)?.fields).toMatchObject([{ label: "favorite color", value: "green" }])
  expect(first((await lookupAt(other, SITE_B, [field("p", "Favorite color")])).matches)).toMatchObject({
    source: "exact",
    value: "red",
  })

  expect(await call(appRouter.learning.forgetSite, { siteKey: SITE }, other())).toEqual({ removedForms: 1 })
  expect(await call(appRouter.learning.forgetSite, { siteKey: SITE }, other())).toEqual({ removedForms: 0 })
  expect(await call(appRouter.learning.siteProfiles, { limit: 50 }, as())).toHaveLength(2)
  expect(await call(appRouter.learning.forgetSite, { siteKey: SITE }, as())).toEqual({ removedForms: 1 })
  expect(first((await lookupAt(as, SITE, [field("p", "Favorite color")])).matches)).not.toMatchObject({
    source: "site",
  })
})

test("a failing site profile query is logged by class and code only, never with the site", async () => {
  const as = await newUser()
  const driverError = () => Object.assign(new Error("Failed query: zebra.dev params: zebra"), { code: "22021" })
  const broken = {
    delete: () => {
      throw driverError()
    },
    select: () => {
      throw driverError()
    },
  } as unknown as Db
  const logged = spyOn(console, "error").mockImplementation(() => {})
  try {
    const errors = await Promise.all([
      call(appRouter.learning.forgetSite, { siteKey: "zebra.dev" }, as({ db: broken })).catch((e) => e),
      call(appRouter.learning.siteProfiles, { limit: 5 }, as({ db: broken })).catch((e) => e),
    ])
    for (const error of errors) expect(error.message).not.toContain("zebra")
    const lines = inspect(logged.mock.calls, { depth: 10 })
    expect(lines).toContain("LearningStoreError")
    for (const text of ["zebra", "Failed query", "params"]) expect(lines).not.toContain(text)
  } finally {
    logged.mockRestore()
  }
})

test("the site profile of a deleted user goes with them", async () => {
  const as = await newUser()
  await record(as, [event("Favorite color", "", "green")])
  await db.delete(user).where(eq(user.id, as().id))
  expect(
    await db.select({ n: sql<number>`count(*)::int` }).from(siteProfile).where(eq(siteProfile.userId, as().id)),
  ).toEqual([{ n: 0 }])
})

const entryOf = async (userId: string, key: string) => (await sitesOf(userId))[0]?.fieldMap[key]

test("an entry copied from an answer keeps its source when the user accepts it, and still dies when the answer changes", async () => {
  const as = await newUser()
  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Ana" }, as())
  await record(as, [event("Preferred name", "Ana", "Ana", { source: "answer" })])
  await record(as, [event("Preferred name", "Ana", "Ana", { source: "site" })])
  expect(await entryOf(as().id, "preferred name|text")).toMatchObject({
    source: "answer",
    answerId: expect.any(String),
  })
  const ask = () => lookupAt(as, SITE, [field("n", "Preferred name")])
  expect(first((await ask()).matches)).toMatchObject({ source: "site", value: "Ana" })

  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Anita" }, as())
  expect(first((await ask()).matches)).toMatchObject({ source: "label", value: "Anita" })
})

test("a profile entry keeps its source and time when accepted, and a later record of the form doesn't bring a stale one back", async () => {
  const as = await newUser()
  const at = (days: number) => ({ now: () => new Date(Date.now() + days * DAY) })
  const form = (source: "profile" | "site") => [
    event("Email", "a@b.dev", "a@b.dev", { source }),
    event("Favorite color", "x", "x", { source: "ai" }),
  ]
  await record(as, form("profile"), {}, at(0))
  await db.insert(profile).values({ userId: as().id, data: {} as never, updatedAt: new Date(Date.now() + DAY) })
  const savedAt = (await entryOf(as().id, "email|text"))?.savedAt

  const ask = () => lookupAt(as, SITE, [field("e", "Email"), field("p", "Favorite color")])
  expect((await ask()).matches.map((m) => m.source)).toEqual(["none", "site"])
  await record(as, form("site"), {}, at(2))
  expect(await entryOf(as().id, "email|text")).toMatchObject({ source: "profile", savedAt })
  expect((await ask()).matches.map((m) => m.source)).toEqual(["none", "site"])
})

test("the exact form is found however many newer forms the site has", async () => {
  const as = await newUser()
  await record(as, [event("Favorite color", "", "green")])
  await db.insert(siteProfile).values(
    Array.from({ length: 25 }, (_, i) => ({
      userId: as().id,
      siteKey: SITE,
      formSignature: `other${i}`,
      fieldKeys: [`field ${i}|text`],
      fieldMap: {},
      lastUsedAt: new Date(Date.now() + (i + 1) * 1_000),
    })),
  )
  await atSite(as, SITE_B, [event("Favorite color", "green", "blue")])
  expect(first((await lookupAt(as, SITE, [field("p", "Favorite color")])).matches)).toMatchObject({
    source: "site",
    value: "green",
  })
})

test("a select whose options change every visit stays one form, and an unseen option set still matches", async () => {
  const as = await newUser()
  for (let i = 0; i < 40; i++) {
    await record(as, [
      event("Notice period", "2 weeks", "2 weeks", { type: "select", options: [`${i} days`, "2 weeks"], source: "ai" }),
      event("Favorite color", "x", "x", { source: "ai" }),
    ])
  }
  expect(await sitesOf(as().id)).toHaveLength(1)
  const { matches } = await lookupAt(as, SITE, [
    select("n", "Notice period", ["never seen", "2 weeks"]),
    field("p", "Favorite color"),
  ])
  expect(matches).toMatchObject([
    { source: "site", value: "2 weeks" },
    { source: "site", value: "x" },
  ])
})

test("one site keeps 20 forms and drops its own oldest, other sites are untouched", async () => {
  const as = await newUser()
  const row = (siteKey: string, i: number) => ({
    userId: as().id,
    siteKey,
    formSignature: `${siteKey}${i}`,
    fieldKeys: [],
    fieldMap: {},
    lastUsedAt: new Date(Date.now() - (100 - i) * 60_000),
  })
  await db.insert(siteProfile).values([...Array.from({ length: 20 }, (_, i) => row(SITE, i)), row(SITE_B, 0)])
  await record(as, [event("Favorite color", "", "green")])
  const rows = await sitesOf(as().id)
  const signatures = rows.filter((r) => r.siteKey === SITE).map((r) => r.formSignature)
  expect(signatures).toHaveLength(20)
  expect(signatures).not.toContain(`${SITE}0`)
  expect(signatures).toContain(`${SITE}1`)
  expect(rows.filter((r) => r.siteKey === SITE_B)).toHaveLength(1)
})

test("record says whether the form was saved, warns about a partial one and still saves it", async () => {
  const as = await newUser()
  const labels = ["Alpha one", "Beta two", "Gamma three", "Delta four", "Epsilon five", "Zeta six"]
  const all = labels.map((label) => event(label, "x", "x", { source: "ai" }))
  expect(await record(as, all)).toMatchObject({ siteProfile: { status: "saved" }, answers: { status: "saved" } })
  expect((await record(as, all)).siteProfile).toEqual({ status: "saved" })
  expect((await record(as, all.slice(0, 2))).siteProfile).toEqual({ status: "saved", warning: "partial_form" })
  expect(await sitesOf(as().id)).toHaveLength(2)
  // the small form is the latest now, so a full one isn't a part of it
  expect((await record(as, all)).siteProfile).toEqual({ status: "saved" })
  expect(await record(as, [event("Password", "", "hunter2", { type: "password" })])).toMatchObject({
    recorded: 0,
    siteProfile: { status: "skipped", reason: "no_learnable_fields" },
  })
})

test("a full answer bank skips only the new questions: events, updates and the site profile still go in", async () => {
  const as = await newUser()
  await db.insert(answer).values(
    Array.from({ length: 2000 }, (_, i) => ({
      userId: as().id,
      normalizedLabel: `l${i}`,
      rawLabel: `l${i}`,
      value: "x",
    })),
  )
  const events = [
    event("One more", "", "x"),
    event("L7", "x", "changed"),
    event("Nickname", "Ana", "Ana", { source: "ai" }),
  ]
  expect(await record(as, events)).toMatchObject({
    recorded: 3,
    answers: { status: "bank_full", skipped: 1 },
    siteProfile: { status: "saved" },
  })
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toHaveLength(3)
  expect(await answerOf(as().id, "one more")).toBeUndefined()
  expect(await answerOf(as().id, "l7")).toMatchObject({ value: "changed", timesCorrected: 1 })
  expect(Object.keys((await sitesOf(as().id))[0]!.fieldMap).sort()).toEqual([
    "l7|text",
    "nickname|text",
    "one more|text",
  ])
})

test("a replayed batch gets the first answer back and applies nothing", async () => {
  const as = await newUser()
  await db.insert(answer).values(
    Array.from({ length: 2000 }, (_, i) => ({
      userId: as().id,
      normalizedLabel: `l${i}`,
      rawLabel: `l${i}`,
      value: "x",
    })),
  )
  const batchId = crypto.randomUUID()
  const events = [event("One more", "", "x"), event("Nickname", "Ana", "Ana", { source: "ai" })]
  const first = await record(as, events, { batchId })
  expect(first).toMatchObject({ answers: { status: "bank_full", skipped: 1 }, siteProfile: { status: "saved" } })
  expect(await record(as, events, { batchId })).toEqual(first)
  expect(await db.select().from(fieldEvent).where(eq(fieldEvent.userId, as().id))).toHaveLength(2)
  expect(await sitesOf(as().id)).toMatchObject([{ timesUsed: 1 }])
})

test("forgetting a site while records of it run neither deadlocks nor leaves a half written form", async () => {
  const as = await newUser()
  const forms = Array.from({ length: 20 }, (_, i) =>
    i % 2 === 0
      ? record(as, [event("Alpha", "1", "1", { source: "ai" }), event("Beta", "2", "2", { source: "ai" })])
      : call(appRouter.learning.forgetSite, { siteKey: SITE }, as()),
  )
  await Promise.all(forms)
  const rows = await sitesOf(as().id)
  expect(rows.length).toBeLessThanOrEqual(1)
  for (const row of rows) expect(Object.keys(row.fieldMap).sort()).toEqual(["alpha|text", "beta|text"])
})

test("a changed form keeps where an entry came from when the user accepts it, for answers and for the profile", async () => {
  const as = await newUser()
  const labels = ["Alpha one", "Beta two", "Gamma three", "Delta four", "Preferred name"]
  const at = (days: number) => ({ now: () => new Date(Date.now() + days * DAY) })
  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Ana" }, as())
  const form = (source: "answer" | "site", extra: object[] = []) => [
    ...labels.slice(0, 3).map((label) => event(label, "x", "x", { source: "ai" })),
    event("Email", "a@b.dev", "a@b.dev", { source: source === "answer" ? "profile" : "site" }),
    event("Preferred name", "Ana", "Ana", { source }),
    ...extra,
  ]
  await record(as, form("answer"), {}, at(0))
  await db.insert(profile).values({ userId: as().id, data: {} as never, updatedAt: new Date(Date.now() + DAY) })

  // a sixth field: 5 of 6 fields in common, so it is looked up as the saved form and recorded as a new one
  const changed = [
    ...labels.slice(0, 3).map((label, i) => field(`f${i}`, label)),
    field("e", "Email"),
    field("n", "Preferred name"),
    field("z", "Zeta six"),
  ]
  const asked = await lookupAt(as, SITE, changed)
  expect(asked.matches.map((m) => m.source)).toEqual(["site", "site", "site", "none", "site", "none"])
  await record(as, form("site", [event("Zeta six", "", "6")]), {}, at(2))

  const rows = await sitesOf(as().id)
  expect(rows).toHaveLength(2)
  const grown = rows.find((r) => r.fieldKeys.length === 6)!
  expect(grown.fieldMap["preferred name|text"]).toMatchObject({ source: "answer", answerId: expect.any(String) })
  expect(grown.fieldMap["email|text"]).toMatchObject({ source: "profile" })

  await call(appRouter.answers.create, { rawLabel: "Preferred name", value: "Anita" }, as())
  const again = await lookupAt(as, SITE, changed)
  expect(again.matches.map((m) => m.source)).toEqual(["site", "site", "site", "none", "label", "site"])
  expect(first(again.matches.slice(4))).toMatchObject({ value: "Anita" })
})
