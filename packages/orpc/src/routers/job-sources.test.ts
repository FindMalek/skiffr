import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test"
import { call } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { WATCH_SOURCES_MAX } from "@skiffr/common/constants"
import { type Db, job, jobSource } from "@skiffr/db"
import type { Context } from "../context"
import { connectDb } from "../lib/gmail/test-support"
import { type MockSite, startMockSite, testRuntime, testTransport } from "../lib/watch/test-support"
import { TOKEN_PROCEDURES } from "../procedures"
import { appRouter } from "./index"

let db: Db
let drop: () => Promise<void>
let site: MockSite
let clock = new Date("2026-11-10T10:00:00Z")

beforeAll(async () => {
  const connected = await connectDb(["ana", "ben", "cy"])
  db = connected.db
  drop = connected.drop
})
afterAll(async () => {
  await drop()
})
beforeEach(async () => {
  site = await startMockSite()
  clock = new Date("2026-11-10T10:00:00Z")
  await db.delete(jobSource)
  await db.delete(job)
})
afterEach(async () => {
  await site.close()
})

function as(userId: string, watch = true): { context: Context } {
  return {
    context: {
      db,
      now: () => clock,
      session: { user: { id: userId } } as Session,
      headers: new Headers({ "x-csrf-token": "orpc" }),
      bearer: false,
      watch: watch ? testRuntime(testTransport(site)) : null,
    } as unknown as Context,
  }
}

const add = (userId: string, url: string, label = "Acme") =>
  call(appRouter.jobSources.create, { url, label }, as(userId))

test("a source is saved once however the url is written, with its kind taken from a known board", async () => {
  const page = await add("ana", "https://Acme.dev/careers/#open")
  expect(page).toMatchObject({
    url: "https://acme.dev/careers",
    kind: "auto",
    enabled: true,
    status: "pending",
    lastError: null,
  })
  expect((await add("ana", "https://acme.dev/careers", "Other")).id).toBe(page.id)
  expect((await add("ana", "https://jobs.lever.co/acme")).kind).toBe("lever")
  expect((await add("ana", "https://boards.greenhouse.io/acme")).kind).toBe("greenhouse")
  expect(await call(appRouter.jobSources.list, {}, as("ana"))).toHaveLength(3)
})

test("addresses that could reach inside a network are refused when added", async () => {
  for (const url of [
    "file:///etc/passwd",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://2130706433/",
    "http://user:pw@acme.dev/",
    "https://acme.dev:8443/",
    "http://metadata.google.internal/",
  ]) {
    await expect(add("ana", url), url).rejects.toMatchObject({ code: "BAD_REQUEST" })
  }
  expect(await call(appRouter.jobSources.list, {}, as("ana"))).toEqual([])
})

test("a user can watch at most the cap, even with requests racing, and the cap is per user", async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: WATCH_SOURCES_MAX + 5 }, (_, i) => add("ana", `https://acme.dev/careers/${i}`)),
  )
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(WATCH_SOURCES_MAX)
  expect(await call(appRouter.jobSources.list, { limit: 500 }, as("ana"))).toHaveLength(WATCH_SOURCES_MAX)
  await expect(add("ana", "https://acme.dev/one-more")).rejects.toMatchObject({ code: "BAD_REQUEST" })
  expect(await add("ben", "https://acme.dev/careers/0")).toMatchObject({ enabled: true })
})

test("sources are private to their owner: not listed, changed, run or removed by anyone else", async () => {
  const source = await add("ana", "http://acme.test/feed")
  expect(await call(appRouter.jobSources.list, {}, as("ben"))).toEqual([])
  const asBen = as("ben")
  for (const attempt of [
    () => call(appRouter.jobSources.update, { id: source.id, enabled: false }, asBen),
    () => call(appRouter.jobSources.update, { id: source.id, label: "Mine now" }, asBen),
    () => call(appRouter.jobSources.runNow, { id: source.id }, asBen),
    () => call(appRouter.jobSources.remove, { id: source.id }, asBen),
  ]) {
    await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" })
  }
  expect(site.hits).toEqual([])
  expect(await call(appRouter.jobSources.list, {}, as("ana"))).toHaveLength(1)
})

test("the list never carries fetch bookkeeping", async () => {
  await add("ana", "https://acme.dev/careers")
  const [row] = await call(appRouter.jobSources.list, {}, as("ana"))
  expect(Object.keys(row!).sort()).toEqual(
    [
      "createdAt",
      "enabled",
      "id",
      "kind",
      "label",
      "lastAdded",
      "lastCheckedAt",
      "lastError",
      "lastFound",
      "nextAttemptAt",
      "status",
      "url",
    ].sort(),
  )
})

test("run now fetches, queues the postings and reports the counts; a second click within a minute is refused", async () => {
  site.route("/feed", (_, res) => {
    res.setHeader("content-type", "application/rss+xml")
    res.end(
      "<rss><channel><item><title>Engineer</title><link>https://acme.test/careers/engineer</link></item></channel></rss>",
    )
  })
  const source = await add("ana", "http://acme.test/feed")
  expect(await call(appRouter.jobSources.runNow, { id: source.id }, as("ana"))).toEqual({
    state: "done",
    found: 1,
    added: 1,
  })
  await expect(call(appRouter.jobSources.runNow, { id: source.id }, as("ana"))).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  })
  const [row] = await call(appRouter.jobSources.list, {}, as("ana"))
  expect(row).toMatchObject({ status: "ok", kind: "feed", lastFound: 1, lastAdded: 1 })
  const queued = await call(appRouter.jobs.list, {}, as("ana"))
  expect(queued).toMatchObject([{ title: "Engineer", source: "watch:Acme" }])
})

test("a source that fails shows a fixed code, not what the site said", async () => {
  site.route("/feed", (_, res) => void res.writeHead(500).end("internal path /srv/secret"))
  const source = await add("ana", "http://acme.test/feed")
  const spy = spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await call(appRouter.jobSources.runNow, { id: source.id }, as("ana"))).toMatchObject({
      state: "stopped",
      error: "upstream",
    })
  } finally {
    spy.mockRestore()
  }
  const [row] = await call(appRouter.jobSources.list, {}, as("ana"))
  expect(JSON.stringify(row)).not.toContain("secret")
  expect(row).toMatchObject({ status: "error", lastError: "upstream" })
})

test("turning a source off stops it from running, turning it on makes it due now, and a label can change", async () => {
  const source = await add("ana", "http://acme.test/feed")
  const off = await call(appRouter.jobSources.update, { id: source.id, enabled: false }, as("ana"))
  expect(off.enabled).toBe(false)
  await expect(call(appRouter.jobSources.runNow, { id: source.id }, as("ana"))).rejects.toMatchObject({
    code: "CONFLICT",
  })
  expect(site.hits).toEqual([])
  const on = await call(appRouter.jobSources.update, { id: source.id, enabled: true, label: "Renamed" }, as("ana"))
  expect(on).toMatchObject({ enabled: true, label: "Renamed", nextAttemptAt: null })
})

test("without a watcher on the server run now is unavailable", async () => {
  const source = await add("ana", "http://acme.test/feed")
  const spy = spyOn(console, "error").mockImplementation(() => {})
  try {
    await expect(call(appRouter.jobSources.runNow, { id: source.id }, as("ana", false))).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    })
  } finally {
    spy.mockRestore()
  }
})

test("sources are session only: none is on the token list and a valid extension token gets 403 on each", async () => {
  expect([...TOKEN_PROCEDURES].filter((path) => path.startsWith("jobSources."))).toEqual([])
  const bearer = {
    context: {
      db,
      now: () => clock,
      session: null,
      headers: new Headers({ authorization: "Bearer skp_x" }),
      bearer: true,
      tokenUnavailable: false,
      token: { id: "t", name: "t", prefix: "skp_", last4: "xxxx", expiresAt: null, user: { id: "cy" } },
      watch: testRuntime(testTransport(site)),
    } as unknown as Context,
  }
  const inputs = {
    list: {},
    create: { url: "http://acme.test/feed", label: "x" },
    update: { id: crypto.randomUUID(), enabled: false },
    runNow: { id: crypto.randomUUID() },
    remove: { id: crypto.randomUUID() },
  }
  const procedures = appRouter.jobSources as unknown as Record<string, Parameters<typeof call>[0]>
  expect(Object.keys(procedures).sort()).toEqual(Object.keys(inputs).sort())
  for (const [name, input] of Object.entries(inputs)) {
    await expect(call(procedures[name]!, input as never, bearer), name).rejects.toMatchObject({ code: "FORBIDDEN" })
  }
  expect(site.hits).toEqual([])
})
