import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { call } from "@orpc/server"
import { isLearnableField } from "@skiffr/ai"
import { type Auth, createAuth, type Session } from "@skiffr/auth"
import { canonicalizeJob } from "@skiffr/common/utils"
import {
  answer,
  apiToken,
  application,
  cvConnection,
  type Db,
  fieldEvent,
  findSimilarAnswers,
  gmailAccount,
  job,
  jobSource,
  notes,
  siteProfile,
  user,
} from "@skiffr/db"
import { buildScenario } from "@skiffr/db/seed"
import { loadApiEnv } from "@skiffr/env/api"
import { appRouter, type Context } from "@skiffr/orpc"
import { API_KEY, CV_KEY, type MockRr, mockCvRuntime, startMockRr } from "@skiffr/orpc/cv-test"
import { connectDb } from "@skiffr/orpc/gmail-test"
import { and, count, eq, max, ne } from "drizzle-orm"
import { createServer } from "../server"
import { fakeEmbedding } from "./embedding"
import { DEMO_USER, SECOND_USER } from "./fixtures"
import { assertPreviewSeedAllowed, SeedRefusedError } from "./guard"
import { type PreviewSeedResult, SeedConflictError, seedPreview, tokenSecret } from "./preview"
import { runPreviewSeed } from "./run"

// every test here migrates and seeds a pglite db: the 5s default fails on a loaded ci runner
setDefaultTimeout(30_000)

const NOW = new Date("2026-11-12T15:00:00Z")
const PASSWORD = "skiffr-preview-demo"
const DASHBOARD = "http://localhost:3002"
const PLAYGROUND = "https://playground.skiffr.test"

let db: Db
let drop: () => Promise<void>
let auth: Auth
let first: PreviewSeedResult
let seconds = 0

const options = { password: PASSWORD, dashboardUrl: DASHBOARD, now: NOW, playgroundUrl: PLAYGROUND, cvKey: CV_KEY }

beforeAll(async () => {
  const connected = await connectDb([])
  db = connected.db
  drop = connected.drop
  auth = createAuth({
    db,
    secret: "s".repeat(40),
    dashboardUrl: DASHBOARD,
    trustedOrigins: [DASHBOARD],
    secureCookies: false,
  })
  const started = performance.now()
  first = await seedPreview(db, auth, options)
  seconds = (performance.now() - started) / 1000
}, 60_000)
afterAll(async () => {
  await drop()
})

const asUser = (userId: string, extra: Partial<Context> = {}) => ({
  context: {
    db,
    now: () => NOW,
    session: { user: { id: userId } } as Session,
    headers: new Headers({ "x-csrf-token": "orpc" }),
    bearer: false,
    ...extra,
  } as unknown as Context,
})

const rows = <T extends { userId: string }>(all: T[], userId: string) => all.filter((row) => row.userId === userId)

test("seeds in a few seconds and is the dataset the product needs", async () => {
  expect(seconds).toBeLessThan(10)
  expect(first.seeded).toBe(true)

  const answers = rows(await db.select().from(answer), DEMO_USER.id)
  expect(answers.length).toBeGreaterThanOrEqual(60)
  expect(new Set(answers.map((row) => row.status))).toEqual(new Set(["learned", "confirmed", "rejected"]))
  expect(new Set(answers.map((row) => row.source))).toEqual(new Set(["manual", "autofill", "ai", "import"]))
  expect(answers.every((row) => row.embedding?.length === 1536 && row.fingerprint)).toBe(true)
  expect(answers.some((row) => row.timesCleared >= 3 && row.timesCorrected > 0)).toBe(true)

  const jobs = rows(await db.select().from(job), DEMO_USER.id)
  expect(jobs.length).toBeGreaterThanOrEqual(80)
  expect(new Set(jobs.map((row) => row.status))).toEqual(new Set(["queued", "applied", "skipped"]))
  const sources = new Set(jobs.map((row) => row.source))
  for (const source of ["manual", "extension", "gmail:linkedin", "gmail:indeed", "gmail:glassdoor", "gmail:other"]) {
    expect(sources.has(source)).toBe(true)
  }
  expect([...sources].filter((source) => source.startsWith("watch:")).length).toBeGreaterThanOrEqual(3)

  const applications = rows(await db.select().from(application), DEMO_USER.id)
  expect(applications).toHaveLength(40)
  expect(new Set(applications.map((row) => row.status))).toEqual(
    new Set(["applied", "responded", "interview", "offer", "rejected"]),
  )

  expect(rows(await db.select().from(siteProfile), DEMO_USER.id).length).toBeGreaterThanOrEqual(5)
  expect((await db.select().from(jobSource)).map((row) => [row.status, row.enabled])).toEqual(
    expect.arrayContaining([
      ["error", true],
      ["ok", false],
      ["pending", true],
      ["ok", true],
    ]),
  )
  const [gmail] = await db.select().from(gmailAccount)
  expect(gmail?.status).toBe("needs_reconnect")
  expect(rows(await db.select().from(fieldEvent), DEMO_USER.id).length).toBeGreaterThan(300)
})

test("every application has its job, and statuses agree with dates and with the job", async () => {
  const jobs = new Map((await db.select().from(job)).map((row) => [row.id, row]))
  const applications = await db.select().from(application)
  for (const row of applications) {
    const linked = jobs.get(row.jobId)!
    expect(linked.userId).toBe(row.userId)
    expect(linked.status).toBe("applied")
    expect(linked.queuedAt.getTime()).toBeLessThanOrEqual(row.appliedAt.getTime())
    const stages = [row.appliedAt, row.respondedAt, row.interviewAt, row.offerAt].filter(
      (at): at is Date => at !== null,
    )
    expect(stages.map(Number)).toEqual([...stages.map(Number)].sort((a, b) => a - b))
    for (const at of [row.appliedAt, row.respondedAt, row.interviewAt, row.offerAt, row.rejectedAt]) {
      if (at) expect(at.getTime()).toBeLessThanOrEqual(NOW.getTime())
    }
    if (row.status === "applied")
      expect([row.respondedAt, row.interviewAt, row.offerAt, row.rejectedAt]).toEqual([null, null, null, null])
    if (row.status === "responded") expect(row.respondedAt).not.toBeNull()
    if (row.status === "interview") expect(row.interviewAt).not.toBeNull()
    if (row.status === "offer") expect(row.offerAt).not.toBeNull()
    if (row.status === "rejected") expect(row.rejectedAt).not.toBeNull()
  }
  const appliedJobs = [...jobs.values()].filter((row) => row.status === "applied")
  expect(appliedJobs.length).toBe(applications.length)
})

test("the stats page has a ten week funnel with every chart populated", async () => {
  const stats = await call(appRouter.stats.overview, { days: 90 }, asUser(DEMO_USER.id))
  expect(stats.stages.applied).toBe(40)
  expect(stats.stages.responded).toBeGreaterThan(stats.stages.interview)
  expect(stats.stages.interview).toBeGreaterThan(stats.stages.offer)
  expect(stats.perWeek.filter((week) => week.count > 0).length).toBeGreaterThanOrEqual(10)
  expect(stats.byMatch.filter((bucket) => bucket.applied > 0).length).toBeGreaterThanOrEqual(4)
  expect(stats.byAts.length).toBeGreaterThanOrEqual(5)
  expect(stats.timeToApply.buckets.every((bucket) => bucket.count > 0)).toBe(true)
  expect(stats.bySource.length).toBeGreaterThanOrEqual(6)
  expect(stats.autofill.accepted).toBeGreaterThan(stats.autofill.corrected)
  const events = rows(await db.select().from(fieldEvent), DEMO_USER.id).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )
  const share = (part: typeof events) => part.filter((event) => event.outcome === "corrected").length / part.length
  const third = Math.floor(events.length / 3)
  expect(share(events.slice(0, third))).toBeGreaterThan(share(events.slice(-third)) * 2)
  expect(stats.autofill.forms).toBe(40)
})

test("the answers page has something to decide: answers to keep, ones that keep changing and ones that get cleared", async () => {
  const suggestions = await call(appRouter.learning.suggestions, undefined, asUser(DEMO_USER.id))
  expect(new Set(suggestions.map((suggestion) => suggestion.kind))).toEqual(new Set(["flip_flop", "keep", "cleared"]))
})

test("the queue opens the oldest job first, has twins, a hostile title and playground urls", async () => {
  const next = await call(appRouter.jobs.next, undefined, asUser(DEMO_USER.id))
  const queued = rows(await db.select().from(job), DEMO_USER.id).filter((row) => row.status === "queued")
  expect(next?.queuedAt.getTime()).toBe(Math.min(...queued.map((row) => row.queuedAt.getTime())))
  expect(Date.parse(next!.queuedAt.toISOString())).toBeLessThan(NOW.getTime() - 12 * 864e5)
  expect(queued.every((row) => row.url.startsWith(PLAYGROUND))).toBe(true)

  const hostile = queued.find((row) => row.title.includes("\u202e"))
  expect(hostile?.title).toContain("<img")

  const seen = new Map<string, number>()
  for (const row of queued) seen.set(`${row.company}|${row.title}`, (seen.get(`${row.company}|${row.title}`) ?? 0) + 1)
  expect([...seen.values()].filter((n) => n > 1).length).toBeGreaterThanOrEqual(3)

  const batch = new Map<string, number>()
  for (const row of queued.filter((r) => r.source.startsWith("watch:")))
    batch.set(`${row.source}@${row.queuedAt.getTime()}`, 1)
  expect(batch.size).toBeLessThan(queued.filter((r) => r.source.startsWith("watch:")).length)
})

test("the dedupe urls in the links resolve to the job they name", async () => {
  expect(first.links.dedupe.length).toBeGreaterThan(0)
  const queued = rows(await db.select().from(job), DEMO_USER.id)
  for (const variant of first.links.dedupe) {
    const canonical = canonicalizeJob(variant.url).canonicalId
    expect(queued.filter((row) => row.canonicalId === canonical)).toHaveLength(1)
  }
})

test("similar questions are found without a provider, and only among the user's own answers", async () => {
  const [hit] = await findSimilarAnswers(db, DEMO_USER.id, fakeEmbedding("What compensation do you expect"), 3)
  expect(hit?.normalizedLabel).toContain("desired salary")
  const rejected = await findSimilarAnswers(db, DEMO_USER.id, fakeEmbedding("current compensation"), 5)
  expect(rejected.some((row) => row.status === "rejected")).toBe(false)
  const other = await findSimilarAnswers(db, SECOND_USER.id, fakeEmbedding("desired salary"), 3)
  expect(other[0]?.value).toBe("EUR 85,000 per year")
})

test("users are isolated: the second user sees only their own data, even for a posting both saved", async () => {
  const mine = await call(appRouter.jobs.list, { limit: 500, offset: 0 }, asUser(SECOND_USER.id))
  expect(mine.length).toBeGreaterThan(0)
  const ids = new Set((await db.select().from(job).where(eq(job.userId, DEMO_USER.id))).map((row) => row.id))
  expect(mine.some((row) => ids.has(row.id))).toBe(false)
  const demoCanonical = new Set(
    (await db.select().from(job).where(eq(job.userId, DEMO_USER.id))).map((row) => row.canonicalId),
  )
  expect(mine.some((row) => demoCanonical.has(row.canonicalId))).toBe(true)
  const apps = await call(appRouter.applications.list, { limit: 100, offset: 0 }, asUser(SECOND_USER.id))
  expect(apps.length).toBeGreaterThan(0)
  expect(apps.length).toBeLessThan(40)
  expect(
    (
      await db
        .select({ n: count() })
        .from(answer)
        .where(and(eq(answer.userId, SECOND_USER.id), ne(answer.status, "rejected")))
    )[0]?.n,
  ).toBeGreaterThan(0)
})

test("only fake data: reserved or example addresses, fictional phone numbers, and answers the extension could really learn", async () => {
  const emails = (await db.select({ email: user.email }).from(user)).map((row) => row.email)
  expect(emails.every((email) => /@(skiffr\.test|example\.com)$/.test(email))).toBe(true)
  const answers = await db.select().from(answer)
  for (const row of answers) {
    expect(isLearnableField({ label: row.rawLabel, type: row.fingerprint?.split("|")[1] })).toBe(true)
    expect(row.value).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/)
  }
  const profile = await call(appRouter.profile.get, undefined, asUser(DEMO_USER.id))
  expect(profile?.data.identity.phone).toMatch(/555 01\d\d$/)
})

test("the seeded accounts sign in with the given password and the extension token works", async () => {
  for (const email of ["demo@skiffr.test", "admin@skiffr.test", "second@skiffr.test"]) {
    const signedIn = await auth.api.signInEmail({ body: { email, password: PASSWORD } })
    expect(signedIn.user.email).toBe(email)
  }
  const [admin] = await db.select().from(user).where(eq(user.email, "admin@skiffr.test"))
  expect(admin?.role).toBe("admin")

  const server = createServer(
    {
      db,
      auth,
      now: () => NOW,
      config: { deployEnv: "test", githubAuth: false },
      storage: null,
      model: null,
      embeddingModel: null,
    },
    { publicUrl: "http://api.test" },
  )
  const whoami = (secret: string) =>
    server(
      new Request("http://api.test/rpc/extension/whoami", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          origin: `chrome-extension://${"a".repeat(32)}`,
        },
        body: JSON.stringify({}),
      }),
    )
  expect(first.links.extensionToken).toBe(tokenSecret(DEMO_USER.id, "Chrome on laptop"))
  const ok = await whoami(first.links.extensionToken)
  expect(ok.status).toBe(200)
  expect((await ok.json()).json.user.email).toBe("demo@skiffr.test")
  expect((await whoami(tokenSecret(DEMO_USER.id, "Old laptop"))).status).toBe(401)
  expect((await whoami(tokenSecret(DEMO_USER.id, "Trial token"))).status).toBe(401)
  const tokens = await db.select().from(apiToken).where(eq(apiToken.userId, DEMO_USER.id))
  expect(tokens.filter((row) => !row.revokedAt && (!row.expiresAt || row.expiresAt > NOW))).toHaveLength(2)
})

test("the seeded cv connection opens with the server key and talks to the mock Reactive Resume", async () => {
  const mock: MockRr = await startMockRr()
  try {
    const [connection] = await db.select().from(cvConnection)
    expect(connection?.keyLast4).toBe(API_KEY.slice(-4))
    expect(connection?.apiKeyEnc.startsWith("v1.")).toBe(true)
    const status = await call(appRouter.cv.test, undefined, asUser(DEMO_USER.id, { cv: mockCvRuntime(mock) }))
    expect(status).toMatchObject({ resumes: 1 })
  } finally {
    await mock.close()
  }
})

test("a rerun changes nothing, and reset gives back the same rows with fresh dates", async () => {
  const snapshot = async () => ({
    jobs: (await db.select({ id: job.id, canonicalId: job.canonicalId }).from(job).orderBy(job.id)).length,
    ids: (await db.select({ id: answer.id }).from(answer).orderBy(answer.id)).map((row) => row.id),
    users: (await db.select({ n: count() }).from(user))[0]?.n,
  })
  const newest = async () => (await db.select({ at: max(application.appliedAt) }).from(application))[0]!.at!
  const before = await snapshot()
  const newestBefore = await newest()
  const again = await seedPreview(db, auth, options)
  expect(again.seeded).toBe(false)
  expect(await snapshot()).toEqual(before)
  expect(again.links.extensionToken).toBe(first.links.extensionToken)

  const later = new Date(NOW.getTime() + 3 * 864e5)
  const reset = await seedPreview(db, auth, { ...options, now: later, reset: true })
  expect(reset.seeded).toBe(true)
  expect(await snapshot()).toEqual(before)
  expect((await newest()).getTime()).toBeGreaterThan(newestBefore.getTime())
}, 60_000)

async function withFreshDb<T>(run: (db: Db, auth: Auth) => Promise<T>): Promise<T> {
  const other = await connectDb([])
  try {
    const authOther = createAuth({
      db: other.db,
      secret: "s".repeat(40),
      dashboardUrl: DASHBOARD,
      trustedOrigins: [DASHBOARD],
      secureCookies: false,
    })
    return await run(other.db, authOther)
  } finally {
    await other.drop()
  }
}

const PRECIOUS = "00000000-0000-4000-8000-000000000001"

const realUser = (id: string, email: string) => ({
  id,
  name: "Real",
  email,
  emailVerified: true,
  createdAt: NOW,
  updatedAt: NOW,
})

test("a real account on a seed email stops the seed, with or without reset, and keeps its data", async () => {
  await withFreshDb(async (other, authOther) => {
    await other.insert(user).values(realUser("real", "demo@skiffr.test"))
    await other.insert(notes).values({ id: PRECIOUS, userId: "real", title: "mine", body: "keep" })
    for (const reset of [false, true]) {
      await expect(seedPreview(other, authOther, { ...options, reset })).rejects.toBeInstanceOf(SeedConflictError)
      expect((await other.select().from(user)).map((row) => row.id)).toEqual(["real"])
      expect((await other.select().from(notes)).map((row) => row.id)).toEqual([PRECIOUS])
    }
  })
})

test("a real account on a sample user email stops the seed with a conflict, not a raw sql error", async () => {
  await withFreshDb(async (other, authOther) => {
    const sample = buildScenario(NOW, { ownerId: "x" }).users[0]!.email
    await other.insert(user).values(realUser("real", sample))
    await expect(seedPreview(other, authOther, options)).rejects.toBeInstanceOf(SeedConflictError)
    expect((await other.select().from(user)).map((row) => row.id)).toEqual(["real"])
  })
})

test("reset removes only the seed's own rows, a real user with the same postings keeps everything", async () => {
  await withFreshDb(async (other, authOther) => {
    await seedPreview(other, authOther, options)
    const [sample] = await other.select().from(job).where(eq(job.userId, DEMO_USER.id)).limit(1)
    await other.insert(user).values(realUser("real", "someone@example.com"))
    await other.insert(job).values({ ...sample!, id: crypto.randomUUID(), userId: "real" })
    await other.insert(notes).values({ id: PRECIOUS, userId: "real", title: "mine", body: "keep" })
    await seedPreview(other, authOther, { ...options, reset: true })
    expect((await other.select().from(job).where(eq(job.userId, "real"))).map((row) => row.canonicalId)).toEqual([
      sample!.canonicalId,
    ])
    expect((await other.select().from(notes).where(eq(notes.userId, "real"))).length).toBe(1)
    expect((await other.select().from(user).where(eq(user.id, "real"))).length).toBe(1)
  })
})

test("two seeds at once leave one dataset", async () => {
  await withFreshDb(async (other, authOther) => {
    const results = await Promise.all([seedPreview(other, authOther, options), seedPreview(other, authOther, options)])
    expect(results.filter((result) => result.seeded)).toHaveLength(1)
  })
}, 30_000)

test("outside a preview the seed refuses a database that has other users, except the env admin", async () => {
  await withFreshDb(async (other, authOther) => {
    const guarded = { ...options, refuseOtherUsers: true, adminEmail: "Boss@example.com" }
    await other.insert(user).values(realUser("boss", "boss@example.com"))
    expect((await seedPreview(other, authOther, guarded)).seeded).toBe(true)
    await other.insert(user).values(realUser("real", "someone@example.com"))
    await seedPreview(other, authOther, guarded)
    await expect(seedPreview(other, authOther, { ...guarded, reset: true })).rejects.toBeInstanceOf(SeedConflictError)
  })
  await withFreshDb(async (other, authOther) => {
    await other.insert(user).values(realUser("real", "someone@example.com"))
    await expect(seedPreview(other, authOther, { ...options, refuseOtherUsers: true })).rejects.toBeInstanceOf(
      SeedConflictError,
    )
    expect((await other.select().from(user)).map((row) => row.id)).toEqual(["real"])
  })
})

test("the entry point honors SEED_RESET and only lets testers share a pr preview database", async () => {
  const env = (extra: Record<string, string>) =>
    loadApiEnv({ DATABASE_URL: "postgres://unused", BETTER_AUTH_SECRET: "s".repeat(40), SEED: "preview", ...extra })
  await withFreshDb(async (other, authOther) => {
    await other.insert(user).values(realUser("real", "someone@example.com"))
    await expect(runPreviewSeed(other, authOther, env({ DEPLOY_ENV: "local" }))).rejects.toBeInstanceOf(
      SeedConflictError,
    )
    const preview = { DEPLOY_ENV: "pr-9", NODE_ENV: "production" }
    expect((await runPreviewSeed(other, authOther, env(preview))).seeded).toBe(true)
    expect((await runPreviewSeed(other, authOther, env(preview))).seeded).toBe(false)
    expect((await runPreviewSeed(other, authOther, env({ ...preview, SEED_RESET: "on" }))).seeded).toBe(true)
  })
}, 30_000)

test("the entry point reads the env, refuses production before touching the database and writes the links file", async () => {
  const env = (extra: Record<string, string>) =>
    loadApiEnv({ DATABASE_URL: "postgres://unused", BETTER_AUTH_SECRET: "s".repeat(40), SEED: "preview", ...extra })
  const other = await connectDb([])
  try {
    const authOther = createAuth({
      db: other.db,
      secret: "s".repeat(40),
      dashboardUrl: DASHBOARD,
      trustedOrigins: [DASHBOARD],
      secureCookies: false,
    })
    await expect(
      runPreviewSeed(other.db, authOther, env({ NODE_ENV: "production", DEPLOY_ENV: "production" })),
    ).rejects.toBeInstanceOf(SeedRefusedError)
    expect(await other.db.select().from(user)).toEqual([])

    const dir = await mkdtemp(join(tmpdir(), "seed-"))
    const linksPath = join(dir, "seed-links.json")
    const { links } = await runPreviewSeed(
      other.db,
      authOther,
      env({
        NODE_ENV: "production",
        DEPLOY_ENV: "pr-7",
        SEED_DEMO_PASSWORD: "another-password-1",
        PLAYGROUND_URL: PLAYGROUND,
      }),
      { linksPath },
    )
    expect(JSON.parse(await readFile(linksPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(links)))
    expect(links.users.demo.password).toBe("another-password-1")
    expect(links.playground?.nextJob.startsWith(PLAYGROUND)).toBe(true)
    expect((await other.db.select().from(cvConnection)).length).toBe(0)
  } finally {
    await other.drop()
  }
}, 30_000)

test("only an exact local or pr-<n> deploy env may seed, whatever else is set", () => {
  const allowed = (env: Parameters<typeof assertPreviewSeedAllowed>[0]) => {
    try {
      assertPreviewSeedAllowed(env)
      return true
    } catch (error) {
      if (error instanceof SeedRefusedError) return false
      throw error
    }
  }
  const deployEnvs = [
    undefined,
    "",
    "production",
    "Production",
    " production ",
    "production\n",
    "prod",
    "staging",
    "Local",
    " local",
    "pr-",
    "pr-0",
    "pr-01",
    "pr-1a",
    "pr-1\n",
    "PR-1",
    " pr-1",
    "pr--1",
  ]
  for (const NODE_ENV of ["development", "test", "production", undefined]) {
    for (const SEED_ALLOW_PRODUCTION_BUILD of [undefined, "yes"]) {
      for (const DEPLOY_ENV of deployEnvs) {
        expect(allowed({ NODE_ENV, DEPLOY_ENV, SEED_ALLOW_PRODUCTION_BUILD })).toBe(false)
      }
    }
  }
  for (const NODE_ENV of ["development", "test", "production", undefined]) {
    expect(allowed({ NODE_ENV, DEPLOY_ENV: "pr-42" })).toBe(true)
    expect(allowed({ NODE_ENV, DEPLOY_ENV: "pr-1" })).toBe(true)
  }
  expect(allowed({ NODE_ENV: "development", DEPLOY_ENV: "local" })).toBe(true)
  expect(allowed({ NODE_ENV: "test", DEPLOY_ENV: "local" })).toBe(true)
  expect(allowed({ NODE_ENV: undefined, DEPLOY_ENV: "local" })).toBe(false)
  expect(allowed({ NODE_ENV: "production", DEPLOY_ENV: "local" })).toBe(false)
  expect(allowed({ NODE_ENV: "production", DEPLOY_ENV: "local", SEED_ALLOW_PRODUCTION_BUILD: "yes" })).toBe(true)
})
