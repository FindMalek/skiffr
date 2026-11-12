import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test"
import { createRouterClient } from "@orpc/server"
import { mockEmbeddingModel, mockModel } from "@skiffr/ai/testing"
import type { Session } from "@skiffr/auth"
import { EMBEDDING_DIMENSIONS } from "@skiffr/common/constants"
import { aiUsage, aiUsageGlobal, answer, type Db, notes } from "@skiffr/db"
import { createObservability, getObservability, noopObservability, setObservability } from "@skiffr/observability"
import { mockCollector } from "@skiffr/observability/testing"
import { streamText } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { sql } from "drizzle-orm"
import type { Context } from "../context"
import { type AiBudget, budgetedModels } from "../lib/ai-usage"
import { connectDb } from "../lib/gmail/test-support"
import { DEFAULT_RATE_RULES, LIMIT_CLASSES, RateLimiter, type RateRules } from "../lib/rate-limit"
import { CLASS_OVERRIDES, limitClassOf } from "../procedures"
import { appRouter } from "./index"

let db: Db
let drop: () => Promise<void>

beforeAll(async () => {
  const connected = await connectDb(["ana", "ben"])
  db = connected.db
  drop = connected.drop
})
afterAll(async () => {
  await drop()
})
beforeEach(async () => {
  await db.delete(aiUsage)
  await db.delete(aiUsageGlobal)
  await db.delete(answer)
})

const DAY = new Date("2026-11-10T10:00:00Z")
const QUESTION = { question: "Why do you want to work at Initech?" }

interface Extra {
  now?: Date
  limits?: RateLimiter
  aiBudget?: AiBudget
  model?: MockLanguageModelV4
  embeddingModel?: ReturnType<typeof mockEmbeddingModel>
  token?: boolean
}

function as(userId: string, extra: Extra = {}) {
  const user = { id: userId }
  return {
    context: {
      db,
      now: () => extra.now ?? DAY,
      session: extra.token ? null : ({ user } as Session),
      bearer: Boolean(extra.token),
      token: extra.token ? { user } : null,
      headers: new Headers({ "x-csrf-token": "orpc" }),
      limits: extra.limits,
      aiBudget: extra.aiBudget,
      model: extra.model ?? mockModel("A short honest answer."),
      embeddingModel: extra.embeddingModel ?? null,
    } as unknown as Context,
  }
}

/** A router client, not `call`: only a client knows the path of the procedure, which the token check and the limit class are read from. */
const api = (userId: string, extra?: Extra) => createRouterClient(appRouter, as(userId, extra))

const RULES: RateRules = {
  read: { burst: 2, perMinute: 60 },
  write: { burst: 2, perMinute: 60 },
  embed: { burst: 1, perMinute: 60 },
  upload: { burst: 1, perMinute: 60 },
  ai: { burst: 1, perMinute: 60 },
  expensive: { burst: 1, perMinute: 60 },
  sensitive: { burst: 1, perMinute: 60 },
}

function clocked(rules: RateRules = RULES) {
  let at = 0
  return {
    limiter: new RateLimiter(rules, () => at),
    tick: (ms: number) => {
      at += ms
    },
  }
}

const profile = (userId: string, extra?: Extra) =>
  api(userId, extra).profile.upsert({ data: { identity: { firstName: userId } } })
const draft = (userId: string, extra?: Extra, input: { question: string } = QUESTION) =>
  api(userId, extra).ai.draftAnswer(input)

test("every procedure gets a class: model calls and network calls are named, the rest follow the http method", () => {
  expect(limitClassOf("ai.mapFields", "POST")).toBe("ai")
  expect(limitClassOf("cv.preview", "POST")).toBe("ai")
  expect(limitClassOf("notes.summarize", "POST")).toBe("ai")
  expect(limitClassOf("learning.lookup", "POST")).toBe("embed")
  expect(limitClassOf("answers.create", "POST")).toBe("embed")
  expect(limitClassOf("me.avatar", "POST")).toBe("upload")
  expect(limitClassOf("cv.test", "POST")).toBe("expensive")
  expect(limitClassOf("jobSources.runNow", "POST")).toBe("expensive")
  expect(limitClassOf("gmail.syncNow", "POST")).toBe("expensive")
  expect(limitClassOf("jobs.list", "GET")).toBe("read")
  expect(limitClassOf("jobs.update", "PATCH")).toBe("write")
  expect(limitClassOf("jobs.list", undefined)).toBe("write")
})

test("a user over the limit gets a 429 with a wait time and no request data, and another user is not affected", async () => {
  const { limiter, tick } = clocked()
  const extra = { limits: limiter }
  await api("ana", extra).profile.get()
  await api("ana", extra).profile.get()
  const error = await api("ana", extra)
    .profile.get()
    .catch((e) => e)
  expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS", status: 429, data: { retryAfterSeconds: 1 } })
  expect(error.message).toBe("Too many requests. Try again in 1 second.")

  await api("ben", extra).profile.get()
  await profile("ana", extra)
  await profile("ana", extra)
  await expect(profile("ana", extra)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })

  tick(1_000)
  await api("ana", extra).profile.get()
})

test("a token and a session of the same user share the buckets, and a token is limited like a session", async () => {
  const { limiter } = clocked()
  const extra = { limits: limiter }
  await api("ana", { ...extra, token: true }).profile.get()
  await api("ana", extra).profile.get()
  await expect(api("ana", { ...extra, token: true }).profile.get()).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  })
  await expect(api("ana", extra).profile.get()).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  })
})

test("a caller that is refused by auth does not use up anyone's bucket", async () => {
  const { limiter } = clocked()
  const anonymous = { context: { ...as("ana", { limits: limiter }).context, session: null } as unknown as Context }
  for (let i = 0; i < 4; i++) {
    await expect(createRouterClient(appRouter, anonymous).profile.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  }
  await api("ana", { limits: limiter }).profile.get()
})

test("model calls have a tighter bucket than reads, and the limit is hit before the model is called", async () => {
  const { limiter } = clocked()
  await profile("ana")
  const model = mockModel("An answer.")
  await draft("ana", { limits: limiter, model })
  await expect(draft("ana", { limits: limiter, model })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })
  expect(model.doGenerateCalls).toHaveLength(1)
})

function gated() {
  let release!: () => void
  const open = new Promise<void>((resolve) => {
    release = resolve
  })
  const model = mockModel("An answer.")
  const answer = model.doGenerate
  let started = 0
  model.doGenerate = async (options) => {
    started++
    await open
    return (answer as (o: typeof options) => ReturnType<typeof answer>)(options)
  }
  return { model, release, started: () => started }
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(done()).toBe(true)
}

const used = async (userId: string) => (await db.select().from(aiUsage)).filter((row) => row.userId === userId)

test("parallel calls at the daily limit: exactly the budget reaches the model, the rest are refused before it", async () => {
  await profile("ana")
  const { model, release, started } = gated()
  const extra = { model, aiBudget: { dailyCalls: 3, dailyTokens: 0 } }
  const outcomes: Array<{ ok: boolean; error?: unknown }> = []
  const calls = Array.from({ length: 8 }, () =>
    draft("ana", extra).then(
      () => outcomes.push({ ok: true }),
      (error) => outcomes.push({ ok: false, error }),
    ),
  )
  await until(() => started() === 3 && outcomes.filter((o) => !o.ok).length === 5)
  expect(started()).toBe(3)
  for (const outcome of outcomes) {
    expect(outcome.error).toMatchObject({ code: "AI_BUDGET_EXHAUSTED", status: 429 })
  }

  release()
  await Promise.all(calls)
  expect(outcomes.filter((o) => o.ok)).toHaveLength(3)
  expect(model.doGenerateCalls).toHaveLength(3)
  expect(await used("ana")).toMatchObject([{ calls: 3, inputTokens: 3, outputTokens: 3 }])
})

test("the token limit stops the next call once earlier calls spent it, and the model is not called", async () => {
  await profile("ana")
  const model = mockModel("An answer.")
  const extra = { model, aiBudget: { dailyCalls: 0, dailyTokens: 2 } }
  await draft("ana", extra)
  await expect(draft("ana", extra)).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" })
  expect(model.doGenerateCalls).toHaveLength(1)
  expect(await used("ana")).toMatchObject([{ calls: 1, inputTokens: 1, outputTokens: 1 }])
})

test("a provider that reports no usage is counted from the size of the payload", async () => {
  await profile("ana")
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "x".repeat(400) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  })
  await draft("ana", { model })
  const [row] = await used("ana")
  expect(row?.inputTokens).toBeGreaterThan(50)
  expect(row?.outputTokens).toBeGreaterThanOrEqual(100)
})

test("the budget is per user and per UTC day, it resets at midnight, and the wait says how long", async () => {
  await profile("ana")
  await profile("ben")
  const budget = { dailyCalls: 1, dailyTokens: 0 }
  const lateOn10th = new Date("2026-11-10T23:59:30Z")
  const model = mockModel("An answer.")
  await draft("ana", { model, aiBudget: budget, now: lateOn10th })
  const error = await draft("ana", { model, aiBudget: budget, now: lateOn10th }).catch((e) => e)
  expect(error).toMatchObject({ code: "AI_BUDGET_EXHAUSTED", data: { retryAfterSeconds: 30 } })

  await draft("ben", { model, aiBudget: budget, now: lateOn10th })
  await draft("ana", { model, aiBudget: budget, now: new Date("2026-11-11T00:00:00Z") })
  expect(model.doGenerateCalls).toHaveLength(3)
  expect((await used("ana")).map((row) => [row.day, row.calls])).toEqual(
    expect.arrayContaining([
      ["2026-11-10", 1],
      ["2026-11-11", 1],
    ]),
  )
})

test("0 means no limit, and the usage is still counted", async () => {
  await profile("ana")
  const extra = { aiBudget: { dailyCalls: 0, dailyTokens: 0 } }
  for (let i = 0; i < 5; i++) await draft("ana", extra)
  expect(await api("ana", extra).me.usage()).toEqual({
    day: "2026-11-10",
    calls: 5,
    tokens: 10,
    limits: { calls: 0, tokens: 0 },
  })
})

test("usage is today's spend of the signed-in user against the limits, for a session only", async () => {
  await profile("ana")
  await draft("ana")
  const extra = { aiBudget: { dailyCalls: 300, dailyTokens: 1_000_000 } }
  expect(await api("ana", extra).me.usage()).toEqual({
    day: "2026-11-10",
    calls: 1,
    tokens: 2,
    limits: { calls: 300, tokens: 1_000_000 },
  })
  expect(await api("ben", extra).me.usage()).toMatchObject({ calls: 0, tokens: 0 })
  await expect(api("ana", { ...extra, token: true }).me.usage()).rejects.toMatchObject({
    code: "FORBIDDEN",
  })
})

test("a call to a model that is not wrapped by the ai package (a note summary) stops at the budget too", async () => {
  const [note] = await db.insert(notes).values({ userId: "ana", title: "t", body: "b" }).returning()
  const model = mockModel("Short.")
  const extra = { model, aiBudget: { dailyCalls: 1, dailyTokens: 0 } }
  await api("ana", extra).notes.summarize({ id: note!.id })
  await expect(api("ana", extra).notes.summarize({ id: note!.id })).rejects.toMatchObject({
    code: "AI_BUDGET_EXHAUSTED",
  })
  expect(model.doGenerateCalls).toHaveLength(1)
})

test("neither the errors nor the logs carry what the user sent", async () => {
  await profile("ana")
  const logs = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
  ]
  const secret = { question: "my salary history is SECRET-MARKER-123" }
  try {
    const { limiter } = clocked()
    const spent = await draft("ana", { aiBudget: { dailyCalls: 1, dailyTokens: 0 } }, secret)
    expect(spent).toBeDefined()
    const budget = await draft("ana", { aiBudget: { dailyCalls: 1, dailyTokens: 0 } }, secret).catch((e) => e)
    await draft("ana", { limits: limiter }, secret)
    const limited = await draft("ana", { limits: limiter }, secret).catch((e) => e)
    for (const error of [budget, limited]) {
      expect(error.code).toMatch(/TOO_MANY_REQUESTS|AI_BUDGET_EXHAUSTED/)
      expect(JSON.stringify({ message: error.message, data: error.data })).not.toContain("SECRET-MARKER")
    }
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toContain("SECRET-MARKER")
  } finally {
    for (const log of logs) log.mockRestore()
  }
})

const vectorOf = () => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  v[0] = 1
  return v
}
const lookup = (userId: string, labels: string[], extra?: Extra) =>
  api(userId, extra).learning.lookup({
    siteKey: "careers.elsewhere.dev",
    fields: labels.map((label, i) => ({ id: `f${i}`, label, type: "text" })),
  } as never)
const LABELS = Array.from({ length: 20 }, (_, i) => `Question number ${i} about something else`)

test("embeddings take the same budget: a spent budget makes lookup skip the similarity step, not fail, and nothing more is embedded", async () => {
  const embeddingModel = mockEmbeddingModel(vectorOf)
  const extra = { embeddingModel, aiBudget: { dailyCalls: 1, dailyTokens: 0 } }
  await api("ana", extra).answers.create({ rawLabel: "Notice period", value: "1 month" })
  expect(embeddingModel.doEmbedCalls).toHaveLength(1)

  const logs = spyOn(console, "error").mockImplementation(() => {})
  try {
    for (let i = 0; i < 5; i++) {
      const { matches } = await lookup("ana", LABELS, extra)
      expect(matches.every((match) => match.source === "none")).toBe(true)
    }
    expect(logs).not.toHaveBeenCalled()
  } finally {
    logs.mockRestore()
  }
  expect(embeddingModel.doEmbedCalls).toHaveLength(1)
  expect(await api("ana", extra).me.usage()).toMatchObject({ calls: 1, limits: { calls: 1 } })
  expect((await api("ana", extra).me.usage()).tokens).toBeGreaterThan(0)
})

test("saving an answer with a spent budget stores it without the vector", async () => {
  const embeddingModel = mockEmbeddingModel(vectorOf)
  const extra = { embeddingModel, aiBudget: { dailyCalls: 1, dailyTokens: 0 } }
  await api("ana", extra).answers.create({ rawLabel: "Notice period", value: "1 month" })
  const saved = await api("ana", extra).answers.create({ rawLabel: "Favourite colour", value: "blue" })
  expect(saved.value).toBe("blue")
  const rows = await db
    .select({ label: answer.normalizedLabel, embedded: sql<boolean>`embedding is not null` })
    .from(answer)
  expect(rows.sort((a, b) => a.label.localeCompare(b.label))).toEqual([
    { label: "favourite colour", embedded: false },
    { label: "notice period", embedded: true },
  ])
  expect(embeddingModel.doEmbedCalls).toHaveLength(1)
})

test("lookups use the embed bucket, which is tighter than the write bucket", async () => {
  const { limiter } = clocked()
  const extra = { limits: limiter }
  await lookup("ana", ["Notice period"], extra)
  await expect(lookup("ana", ["Notice period"], extra)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })
  await profile("ana", extra)
})

test("the server's own daily cap stops every user, and a user refused by it does not use up a slot of their own", async () => {
  await profile("ana")
  await profile("ben")
  const model = mockModel("An answer.")
  const extra = { model, aiBudget: { dailyCalls: 0, dailyTokens: 0, globalDailyCalls: 2 } }
  await draft("ana", extra)
  await draft("ben", extra)
  await expect(draft("ana", extra)).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED", status: 429 })
  expect(model.doGenerateCalls).toHaveLength(2)
  expect((await used("ana")).map((row) => row.calls)).toEqual([1])
  expect((await db.select().from(aiUsageGlobal)).map((row) => row.calls)).toEqual([2])
})

test("what a provider reports as usage can't refund the budget", async () => {
  await profile("ana")
  const reporting = (input: number) =>
    new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "An answer." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: input, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: input, text: undefined, reasoning: undefined },
        },
        warnings: [],
      }),
    })
  for (const bad of [-500_000, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) await draft("ana", { model: reporting(bad) })
  const [row] = await used("ana")
  expect(row?.calls).toBe(4)
  expect(row?.inputTokens).toBeGreaterThan(0)
  expect(row?.outputTokens).toBeGreaterThan(0)
})

test("a metered model refuses streaming, which it can't count", async () => {
  const { model } = budgetedModels(
    { db, now: () => DAY, user: { id: "ana" } },
    { model: mockModel("x"), embeddingModel: null },
  )
  let failure: unknown
  const stream = streamText({
    model: model!,
    prompt: "hi",
    onError: ({ error }) => {
      failure = error
    },
  })
  await stream.consumeStream()
  expect(String(failure)).toContain("Streaming is not metered")
})

test("every override names a real procedure, and every procedure falls in a class with a rule", () => {
  const paths: string[] = []
  const walk = (node: object, prefix: string[]) => {
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object" && "~orpc" in value) paths.push([...prefix, key].join("."))
      else if (value && typeof value === "object") walk(value, [...prefix, key])
    }
  }
  walk(appRouter, [])
  expect(paths.length).toBeGreaterThan(50)
  for (const name of Object.keys(CLASS_OVERRIDES)) expect(paths).toContain(name)
  for (const name of paths) expect(LIMIT_CLASSES).toContain(limitClassOf(name, "GET"))
  for (const limitClass of Object.values(CLASS_OVERRIDES)) expect(Object.keys(DEFAULT_RATE_RULES)).toContain(limitClass)
})

test("a model call is traced with model and tokens but never the question or the answer, and a spent budget shows as a refusal", async () => {
  const collector = mockCollector()
  setObservability(
    createObservability({
      service: "skiffr-api",
      environment: "test",
      otlpEndpoint: `${collector.url}/api/default`,
      flushMs: 0,
    }),
  )
  try {
    await profile("ana")
    const extra = {
      aiBudget: { dailyCalls: 1, dailyTokens: 0 },
      model: mockModel("An answer nobody should see in a trace."),
    }
    await draft("ana", extra)
    await expect(draft("ana", extra)).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" })
    await getObservability().flush()
    const sent = collector.everything()
    expect(sent).toContain("gen_ai.request.model")
    expect(sent).toContain('"stringValue":"ok"')
    expect(sent).toContain('"stringValue":"budget"')
    expect(sent).not.toContain("Initech")
    expect(sent).not.toContain("nobody should see")
  } finally {
    setObservability(noopObservability)
    collector.stop()
  }
})
