import { afterAll, afterEach, beforeAll, beforeEach, expect, type Mock, spyOn, test } from "bun:test"
import { type Db, job, jobSource } from "@skiffr/db"
import { and, eq } from "drizzle-orm"
import type { Leader } from "../gmail/leader"
import { connectDb } from "../gmail/test-support"
import { queueJob } from "../jobs"
import { FetchError } from "./errors"
import { UserBudget } from "./limits"
import { dueSourceIds, MANUAL_PER_USER_MAX, runDue, runNow, runSource, type WatchDeps } from "./run"
import { createWatchScheduler } from "./scheduler"
import { type MockSite, startMockSite, testRuntime, testTransport } from "./test-support"

let db: Db
let drop: () => Promise<void>
let site: MockSite
let errors: Mock<typeof console.error>
let clock = new Date("2026-11-10T10:00:00Z")
const MIN = 60_000

beforeAll(async () => {
  const connected = await connectDb(["ana", "ben"])
  db = connected.db
  drop = connected.drop
})
afterAll(async () => {
  await drop()
})
beforeEach(async () => {
  errors = spyOn(console, "error").mockImplementation(() => {})
  site = await startMockSite()
  clock = new Date("2026-11-10T10:00:00Z")
  await db.delete(jobSource)
  await db.delete(job)
})
afterEach(async () => {
  errors.mockRestore()
  await site.close()
})

const deps = (options: Parameters<typeof testRuntime>[1] = {}): WatchDeps => ({
  db,
  runtime: testRuntime(testTransport(site), options),
  now: () => clock,
})

const FEED = (titles: string[]) =>
  `<rss><channel>${titles.map((t) => `<item><title>${t}</title><link>https://acme.test/careers/${encodeURIComponent(t)}</link></item>`).join("")}</channel></rss>`

function serveFeed(titles: () => string[], path = "/feed") {
  site.route(path, (req, res) => {
    res.setHeader("content-type", "application/rss+xml")
    res.setHeader("etag", `"${titles().join(",")}"`)
    if (req.headers["if-none-match"] === `"${titles().join(",")}"`) return void res.writeHead(304).end()
    res.end(FEED(titles()))
  })
}

async function addSource(userId: string, values: Partial<typeof jobSource.$inferInsert> = {}) {
  const [row] = await db
    .insert(jobSource)
    .values({ userId, url: "http://acme.test/feed", label: "Acme", ...values })
    .returning()
  return row!
}

const jobsOf = (userId: string) => db.select().from(job).where(eq(job.userId, userId))
const rowOf = async (id: string) => (await db.select().from(jobSource).where(eq(jobSource.id, id)))[0]!

test("new postings are queued once under watch:<label>, and the source is marked checked", async () => {
  serveFeed(() => ["Engineer", "Designer"])
  const source = await addSource("ana")
  const result = await runSource(deps(), source.id)
  expect(result).toEqual({ state: "done", found: 2, added: 2 })
  expect(await jobsOf("ana")).toHaveLength(2)
  expect((await jobsOf("ana")).every((j) => j.source === "watch:Acme" && j.company === "Acme")).toBe(true)
  expect(await rowOf(source.id)).toMatchObject({
    status: "ok",
    kind: "feed",
    lastError: null,
    failures: 0,
    lastFound: 2,
    lastAdded: 2,
    nextAttemptAt: new Date(clock.getTime() + 60 * MIN),
    leaseUntil: null,
  })
  expect(await jobsOf("ben")).toEqual([])
})

test("a posting is not queued again, not even after the user deleted it", async () => {
  serveFeed(() => ["Engineer", "Designer"])
  const source = await addSource("ana")
  await runSource(deps(), source.id)
  await db.delete(job).where(and(eq(job.userId, "ana"), eq(job.title, "Designer")))
  clock = new Date(clock.getTime() + 61 * MIN)
  expect(await runSource(deps(), source.id)).toMatchObject({ found: 2, added: 0 })
  expect((await jobsOf("ana")).map((j) => j.title)).toEqual(["Engineer"])
})

test("a job already in the queue by another route is not queued twice", async () => {
  serveFeed(() => ["Engineer"])
  const source = await addSource("ana")
  await queueJob(
    db,
    "ana",
    { url: "https://acme.test/careers/Engineer", title: "Engineer", company: "Acme", source: "manual" },
    clock,
  )
  expect(await runSource(deps(), source.id)).toMatchObject({ found: 1, added: 0 })
  expect(await jobsOf("ana")).toHaveLength(1)
})

test("a page with markup in its titles is stored as plain text", async () => {
  serveFeed(() => ["<b>Staff</b> Engineer &lt;script&gt;alert(1)&lt;/script&gt;"])
  const source = await addSource("ana")
  await runSource(deps(), source.id)
  const [stored] = await jobsOf("ana")
  expect(stored?.title).not.toMatch(/[<>]/)
  expect(stored?.title.startsWith("Staff Engineer")).toBe(true)
})

test("a long board is queued a hundred at a time, the rest on the next fetch", async () => {
  serveFeed(() => Array.from({ length: 130 }, (_, i) => `Job ${i}`))
  const source = await addSource("ana")
  expect((await runSource(deps(), source.id)).added).toBe(100)
  clock = new Date(clock.getTime() + 61 * MIN)
  expect((await runSource(deps(), source.id)).added).toBe(30)
  expect(await jobsOf("ana")).toHaveLength(130)
})

test("a disabled source is never fetched, by the schedule or by a direct run", async () => {
  serveFeed(() => ["Engineer"])
  const source = await addSource("ana", { enabled: false })
  expect(await dueSourceIds(deps())).toEqual([])
  expect(await runDue(deps())).toEqual([])
  expect(await runSource(deps(), source.id)).toMatchObject({ state: "busy" })
  expect(site.hits).toEqual([])
  expect(await jobsOf("ana")).toEqual([])
})

test("a source that is not due yet, or is being fetched, is left alone", async () => {
  serveFeed(() => ["Engineer"])
  const waiting = await addSource("ana", {
    url: "http://acme.test/feed?a",
    nextAttemptAt: new Date(clock.getTime() + MIN),
  })
  const leased = await addSource("ana", { url: "http://acme.test/feed?b", leaseUntil: new Date(clock.getTime() + MIN) })
  const due = await addSource("ben", { url: "http://acme.test/feed?c", nextAttemptAt: new Date(clock.getTime() - MIN) })
  expect(await dueSourceIds(deps())).toEqual([due.id])
  expect(await runSource(deps(), leased.id)).toMatchObject({ state: "busy" })
  expect(await runSource(deps(), waiting.id)).toMatchObject({ state: "done" })
  clock = new Date(clock.getTime() + 3 * MIN)
  expect((await dueSourceIds(deps())).sort()).toEqual([due.id, leased.id].sort())
})

test("two runs at once fetch a source once", async () => {
  serveFeed(() => ["Engineer"])
  const source = await addSource("ana")
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered: () => void = () => {}
  const inside = new Promise<void>((resolve) => {
    entered = resolve
  })
  const base = testTransport(site)
  const slow: WatchDeps = {
    ...deps(),
    runtime: testRuntime({
      ...base,
      resolve: async (hostname) => {
        entered()
        await held
        return base.resolve(hostname)
      },
      dial: (target) => base.dial(target),
    }),
  }
  const first = runSource(slow, source.id)
  await inside
  const second = await runSource(deps(), source.id)
  release()
  expect([second.state, (await first).state]).toEqual(["busy", "done"])
  expect(site.hits).toHaveLength(1)
})

test("a failing source backs off exponentially, is shown a fixed code, and a blocked address waits a day", async () => {
  site.route("/feed", (_, res) => void res.writeHead(500).end())
  const source = await addSource("ana")
  const waits: number[] = []
  for (let i = 0; i < 4; i++) {
    const result = await runSource(deps(), source.id)
    expect(result).toMatchObject({ state: "stopped", error: "upstream" })
    const row = await rowOf(source.id)
    waits.push((row.nextAttemptAt!.getTime() - clock.getTime()) / MIN)
    expect(row).toMatchObject({ status: "error", lastError: "upstream", failures: i + 1 })
    clock = new Date(row.nextAttemptAt!.getTime() + MIN)
  }
  expect(waits).toEqual([60, 120, 240, 480])

  const blocked = await addSource("ana", { url: "http://10.0.0.1/feed" })
  expect(await runSource(deps(), blocked.id)).toMatchObject({ error: "blocked" })
  expect(((await rowOf(blocked.id)).nextAttemptAt!.getTime() - clock.getTime()) / MIN).toBe(24 * 60)
  expect(site.hits.every((hit) => hit === "GET /feed")).toBe(true)
})

test("a success clears the failure, and a retry-after longer than the backoff is honored", async () => {
  let failing = true
  site.route("/feed", (_, res) => {
    if (failing) return void res.writeHead(429, { "retry-after": "10800" }).end()
    res.setHeader("content-type", "application/rss+xml")
    res.end(FEED(["Engineer"]))
  })
  const source = await addSource("ana")
  expect(await runSource(deps(), source.id)).toMatchObject({ error: "rate_limited" })
  expect(((await rowOf(source.id)).nextAttemptAt!.getTime() - clock.getTime()) / MIN).toBe(180)
  failing = false
  clock = new Date(clock.getTime() + 181 * MIN)
  await runSource(deps(), source.id)
  expect(await rowOf(source.id)).toMatchObject({ status: "ok", lastError: null, failures: 0 })
})

test("a 304 keeps what was found and queues nothing", async () => {
  serveFeed(() => ["Engineer"])
  const source = await addSource("ana")
  await runSource(deps(), source.id)
  clock = new Date(clock.getTime() + 61 * MIN)
  expect(await runSource(deps(), source.id)).toEqual({ state: "done", found: 1, added: 0 })
  expect(site.headers[1]?.["if-none-match"]).toBe('"Engineer"')
  expect(await rowOf(source.id)).toMatchObject({ status: "ok", lastFound: 1 })
})

test("a user over their fetch budget is stopped quietly, without an error on the source", async () => {
  serveFeed(() => ["Engineer"])
  const source = await addSource("ana")
  const limited = deps()
  limited.runtime.budget = new UserBudget(0, 60 * MIN)
  expect(await runSource(limited, source.id)).toMatchObject({ state: "stopped", error: "rate_limited" })
  expect(site.hits).toEqual([])
  expect(await rowOf(source.id)).toMatchObject({ status: "pending", lastError: null, leaseUntil: null })
})

test("logs say the source id, the step and the kind of failure, never a url or page content", async () => {
  site.route("/feed", (_, res) => void res.writeHead(500).end("SECRET-PAGE-CONTENT"))
  const source = await addSource("ana", { url: "http://acme.test/feed?token=SECRET-QUERY" })
  await runSource(deps(), source.id)
  const logged = JSON.stringify(errors.mock.calls)
  expect(logged).toContain(source.id)
  expect(logged).toContain("upstream")
  expect(logged).not.toContain("SECRET")
  expect(logged).not.toContain("acme.test")
})

test("a manual run is once a minute per source and a handful per user, and only for the owner's enabled sources", async () => {
  serveFeed(() => ["Engineer"])
  const source = await addSource("ana")
  expect(await runNow(deps(), "ben", source.id)).toBe("not_found")
  expect(await runNow(deps(), "ana", source.id)).toMatchObject({ state: "done" })
  expect(await runNow(deps(), "ana", source.id)).toBe("too_soon")
  clock = new Date(clock.getTime() + MIN + 1)
  expect(await runNow(deps(), "ana", source.id)).toMatchObject({ state: "done" })

  for (let i = 0; i < MANUAL_PER_USER_MAX; i++) {
    await addSource("ana", { url: `http://acme.test/feed?n=${i}`, lastManualRunAt: new Date(clock.getTime() - MIN) })
  }
  const extra = await addSource("ana", { url: "http://acme.test/feed?extra" })
  expect(await runNow(deps(), "ana", extra.id)).toBe("too_many")

  const off = await addSource("ben", { enabled: false })
  expect(await runNow(deps(), "ben", off.id)).toBe("disabled")
})

const fakeLeader = (leads: boolean): Leader => ({ tryAcquire: async () => leads, release: async () => {} })

test("only the leading replica fetches, and the pass runs the due sources only", async () => {
  serveFeed(() => ["Engineer"])
  const due = await addSource("ana")
  await addSource("ana", { url: "http://acme.test/feed?off", enabled: false })
  const follower = createWatchScheduler(deps(), { leader: fakeLeader(false), intervalMs: 60_000 })
  expect(await follower.tick()).toBe(0)
  expect(site.hits).toEqual([])
  const leader = createWatchScheduler(deps(), { leader: fakeLeader(true), intervalMs: 60_000 })
  expect(await leader.tick()).toBe(1)
  expect(site.hits).toEqual(["GET /feed"])
  expect((await rowOf(due.id)).status).toBe("ok")
  await leader.stop()
})

test("a failure inside the pass is logged without detail and the loop survives", async () => {
  const broken: Leader = {
    tryAcquire: async () => {
      throw new FetchError("internal")
    },
    release: async () => {},
  }
  const scheduler = createWatchScheduler(deps(), { leader: broken, intervalMs: 60_000 })
  expect(await scheduler.tick()).toBe(0)
  expect(await scheduler.tick()).toBe(0)
  expect(errors).toHaveBeenCalledTimes(2)
})
