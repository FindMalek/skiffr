import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test"
import { type Db, gmailAccount, gmailMessage, job } from "@skiffr/db"
import { eq } from "drizzle-orm"
import { queueJob } from "../jobs"
import { syncNow } from "./accounts"
import { INDEED_ALERT, LINKEDIN_ALERT, NEWSLETTER } from "./fixtures"
import type { GmailRuntime } from "./google"
import { type MockGoogle, startMockGoogle } from "./mock-google"
import { DEFAULT_SENDERS } from "./senders"
import { dueAccountIds, LIST_MAX, PROCESS_MAX, syncAccount } from "./sync"
import {
  captureConsole,
  connectAccount,
  connectDb,
  type Harness,
  harness,
  INDEED_FROM,
  LINKEDIN_FROM,
  NOW,
} from "./test-support"

const USERS = [
  "ana",
  "ben",
  "cy",
  "dee",
  "eli",
  "fay",
  "gus",
  "hal",
  "ivy",
  "jo",
  "kim",
  "lee",
  "max",
  "ned",
  "oli",
  "pat",
  "quinn",
  "rae",
]
let db: Db
let drop: () => Promise<void>
let mock: MockGoogle
let h: Harness
let clock = NOW

beforeAll(async () => {
  const connected = await connectDb(USERS)
  db = connected.db
  drop = connected.drop
})
afterAll(async () => {
  await drop()
})
beforeEach(async () => {
  mock = await startMockGoogle()
  h = harness(mock)
  clock = NOW
})
afterEach(async () => {
  await mock.close()
})

const deps = () => ({ db, runtime: h.runtime, now: () => clock, tokens: h.tokens })
const jobsOf = (userId: string) => db.select().from(job).where(eq(job.userId, userId))
const messagesOf = (userId: string) => db.select().from(gmailMessage).where(eq(gmailMessage.userId, userId))
const accountOf = async (userId: string) =>
  (await db.select().from(gmailAccount).where(eq(gmailAccount.userId, userId)))[0]!
const gets = () => mock.requests.filter((r) => /\/messages\/[^/]+$/.test(r.path)).length
const tidied = (id: string) => {
  const labels = mock.messages.get(id)!.labelIds
  return !labels.has("UNREAD") && !labels.has("INBOX") && [...labels].some((l) => mock.labels.get(l) === "skiffr/jobs")
}

test("jobs are queued, then the email is read, out of the inbox and labelled; urls from emails are never fetched", async () => {
  const { id } = await connectAccount(db, mock, "ana")
  mock.add({ id: "m1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  mock.add({ id: "m2", from: INDEED_FROM, html: INDEED_ALERT })
  const seenAtModify: number[] = []
  h.onRequest(async (_method, url) => {
    if (url.endsWith("/modify")) seenAtModify.push((await jobsOf("ana")).length)
  })

  const result = await syncAccount(deps(), id)

  expect(result).toMatchObject({ state: "done", imported: 2, jobsAdded: 4, tidied: 2 })
  const jobs = await jobsOf("ana")
  expect(jobs.map((j) => j.source).sort()).toEqual(["gmail:indeed", "gmail:indeed", "gmail:linkedin", "gmail:linkedin"])
  expect(jobs.map((j) => j.canonicalId)).toContain("linkedin:3912345678")
  expect(jobs.every((j) => j.status === "queued")).toBe(true)
  expect(tidied("m1") && tidied("m2")).toBe(true)
  // every modify came after the jobs were committed
  expect(seenAtModify.length).toBe(2)
  expect(seenAtModify.every((count) => count >= 2)).toBe(true)
  // nothing but the mock was ever called: no posting or tracking link is fetched
  expect(h.urls.every((url) => url.startsWith(mock.url))).toBe(true)
  expect((await accountOf("ana")).lastError).toBeNull()
})

test("a second run changes nothing and does not read the emails again", async () => {
  const { id } = await connectAccount(db, mock, "ben")
  mock.add({ id: "b1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  await syncAccount(deps(), id)
  const before = gets()
  // the user marks it unread again: it is known, so it is not read twice
  mock.messages.get("b1")!.labelIds.add("UNREAD").add("INBOX")
  const result = await syncAccount(deps(), id)
  expect(result).toMatchObject({ state: "done", imported: 0, tidied: 0 })
  expect(gets()).toBe(before)
  expect(await jobsOf("ben")).toHaveLength(2)
})

test("a failed tidy leaves the jobs committed and the next run only repeats the tidy", async () => {
  const { id } = await connectAccount(db, mock, "cy")
  mock.add({ id: "c1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  mock.fail({ match: /POST .*\/modify$/, status: 500, times: 3 })

  const first = await syncAccount(deps(), id)

  expect(first).toMatchObject({ state: "stopped", error: "upstream" })
  expect(await jobsOf("cy")).toHaveLength(2)
  expect(tidied("c1")).toBe(false)
  expect((await messagesOf("cy"))[0]?.modifiedAt).toBeNull()
  const readsBefore = gets()

  const second = await syncAccount(deps(), id)

  expect(second).toMatchObject({ state: "done", tidied: 1 })
  expect(tidied("c1")).toBe(true)
  expect(gets()).toBe(readsBefore)
  expect(await jobsOf("cy")).toHaveLength(2)
  expect((await messagesOf("cy"))[0]?.modifiedAt).not.toBeNull()
})

test("mail without jobs, from the wrong sender or failing authentication is left untouched", async () => {
  const { id } = await connectAccount(db, mock, "dee")
  mock.add({ id: "d1", from: LINKEDIN_FROM, html: NEWSLETTER })
  mock.add({ id: "d2", from: "Jobs <jobalerts-noreply@linkedin.com.evil.example>", html: LINKEDIN_ALERT })
  mock.add({
    id: "d3",
    from: LINKEDIN_FROM,
    html: LINKEDIN_ALERT,
    authentication: "mx.google.com; dkim=fail header.d=linkedin.com; dmarc=fail",
  })
  // gmail's from: also matches a display name: the real address is checked again
  mock.add({ id: "d4", from: '"jobalerts-noreply@linkedin.com" <x@evil.example>', html: LINKEDIN_ALERT })

  const result = await syncAccount(deps(), id)

  expect(result).toMatchObject({ imported: 0, noJobs: 1, skipped: 3, tidied: 0 })
  expect(await jobsOf("dee")).toEqual([])
  for (const mid of ["d1", "d2", "d3", "d4"])
    expect([...mock.messages.get(mid)!.labelIds].sort()).toEqual(["INBOX", "UNREAD"])
  expect((await messagesOf("dee")).map((m) => m.outcome).sort()).toEqual(["no_jobs", "skipped", "skipped", "skipped"])
})

test("a sender is trusted only with a dmarc pass for its own domain", async () => {
  const { id } = await connectAccount(db, mock, "pat")
  const dmarcPass = "mx.google.com; dkim=fail header.d=other.example; dmarc=pass (p=REJECT) header.from=linkedin.com"
  mock.add({ id: "k1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT, authentication: null })
  mock.add({ id: "k2", from: LINKEDIN_FROM, html: LINKEDIN_ALERT, authentication: "mx.google.com; dmarc=none" })
  mock.add({ id: "k3", from: LINKEDIN_FROM, html: LINKEDIN_ALERT, authentication: "mx.google.com; spf=softfail" })
  mock.add({
    id: "k4",
    from: LINKEDIN_FROM,
    html: LINKEDIN_ALERT,
    authentication: "mx.google.com; dmarc=pass header.from=evil.example",
  })
  mock.add({
    id: "k5",
    from: "<a@evil.example>, <jobalerts-noreply@linkedin.com>",
    html: LINKEDIN_ALERT,
    authentication: dmarcPass,
  })

  expect(await syncAccount(deps(), id)).toMatchObject({ imported: 0, skipped: 5 })

  mock.add({ id: "k6", from: LINKEDIN_FROM, html: LINKEDIN_ALERT, authentication: dmarcPass })
  expect(await syncAccount(deps(), id)).toMatchObject({ imported: 1, skipped: 0 })
})

test("the same posting is queued once: across runs and emails", async () => {
  const { id } = await connectAccount(db, mock, "eli")
  mock.add({ id: "e1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  mock.add({ id: "e2", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })

  const result = await syncAccount(deps(), id)

  expect(await jobsOf("eli")).toHaveLength(2)
  expect(result).toMatchObject({ imported: 1, duplicates: 1 })
  // duplicates are tidied too: they are the same jobs, already queued
  expect(["e1", "e2"].every(tidied)).toBe(true)
})

test("a job from gmail and the same job added by hand are one row, whichever came first", async () => {
  const { id } = await connectAccount(db, mock, "rae")
  const add = (url: string) =>
    queueJob(db, "rae", { url, title: "Added by hand", company: "Acme", source: "dashboard" }, NOW)
  expect((await add("https://www.linkedin.com/jobs/view/senior-engineer-at-acme-3912345678?refId=x")).created).toBe(
    true,
  )
  mock.add({ id: "r1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })

  const result = await syncAccount(deps(), id)

  expect(result).toMatchObject({ imported: 1, jobsAdded: 1 })
  expect((await add("https://www.linkedin.com/jobs/view/3987654321/?trackingId=zz")).created).toBe(false)
  expect((await jobsOf("rae")).map((j) => j.canonicalId).sort()).toEqual(["linkedin:3912345678", "linkedin:3987654321"])
})

test("an email from another sender with the same title and company never suppresses a board's jobs", async () => {
  const { id } = await connectAccount(db, mock, "quinn", { senders: [...DEFAULT_SENDERS, "@spam.example"] })
  mock.add({
    id: "l1",
    from: "jobs@spam.example",
    html: '<div><a href="https://phish.example/apply">Senior Software Engineer</a><div>Acme Labs</div></div>',
  })
  mock.add({ id: "l2", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })

  const result = await syncAccount(deps(), id)

  expect(result).toMatchObject({ imported: 2, duplicates: 0 })
  expect((await jobsOf("quinn")).map((j) => j.canonicalId)).toContain("linkedin:3912345678")
  expect(tidied("l2")).toBe(true)
})

test("the label is created once and made again if the user deleted it", async () => {
  const { id } = await connectAccount(db, mock, "fay")
  mock.add({ id: "f1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  await syncAccount(deps(), id)
  expect([...mock.labels.values()]).toEqual(["skiffr/jobs"])
  const first = (await accountOf("fay")).labelId
  expect(first).toBe([...mock.labels.keys()][0]!)

  mock.labels.clear()
  mock.add({ id: "f2", from: LINKEDIN_FROM, html: INDEED_ALERT })
  await syncAccount(deps(), id)
  expect([...mock.labels.values()]).toEqual(["skiffr/jobs"])
  expect((await accountOf("fay")).labelId).toBe([...mock.labels.keys()][0]!)
})

test("the access token is refreshed once and reused, then again after it expires", async () => {
  const { id } = await connectAccount(db, mock, "gus")
  const refreshes = () => mock.requests.filter((r) => r.path === "/token").length
  await syncAccount(deps(), id)
  await syncAccount(deps(), id)
  expect(refreshes()).toBe(1)
  clock = new Date(NOW.getTime() + 6 * 60 * 1000)
  await syncAccount(deps(), id)
  expect(refreshes()).toBe(2)
})

test("a refused refresh token marks the account for reconnecting, and nothing retries it", async () => {
  const { id, refreshToken } = await connectAccount(db, mock, "hal")
  mock.refreshTokens.delete(refreshToken)

  const result = await syncAccount(deps(), id)

  expect(result).toMatchObject({ state: "stopped", error: "auth" })
  expect(await accountOf("hal")).toMatchObject({ status: "needs_reconnect", lastError: "auth", leaseUntil: null })
  const tokenCalls = mock.requests.filter((r) => r.path === "/token").length
  expect(await dueAccountIds(deps())).not.toContain(id)
  expect(await syncAccount(deps(), id)).toMatchObject({ state: "inactive" })
  expect(mock.requests.filter((r) => r.path === "/token").length).toBe(tokenCalls)
})

test("a 403 from gmail means the grant lacks the scope: reconnect", async () => {
  const { id } = await connectAccount(db, mock, "ivy")
  mock.fail({
    match: /GET .*\/messages$/,
    status: 403,
    body: { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } },
  })
  expect(await syncAccount(deps(), id)).toMatchObject({ state: "stopped", error: "scope" })
  expect(await accountOf("ivy")).toMatchObject({ status: "needs_reconnect", lastError: "scope" })
})

test("a rate limit is waited out with backoff, and a persistent one stops the run and resumes later", async () => {
  const { id } = await connectAccount(db, mock, "jo")
  mock.add({ id: "j1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  mock.fail({ match: /GET .*\/messages$/, status: 429, headers: { "retry-after": "2" }, times: 1 })
  expect(await syncAccount(deps(), id)).toMatchObject({ state: "done", imported: 1 })
  expect(h.sleeps).toEqual([2000])

  mock.add({ id: "j2", from: LINKEDIN_FROM, html: INDEED_ALERT.replace(/indeed/g, "linkedin") })
  mock.fail({ match: /GET .*\/messages$/, status: 429, times: 10 })
  const stopped = await syncAccount(deps(), id)
  expect(stopped).toMatchObject({ state: "stopped", error: "rate_limited" })
  const account = await accountOf("jo")
  expect(account.status).toBe("active")
  expect(account.nextAttemptAt!.getTime()).toBeGreaterThan(clock.getTime())
  // the scheduler leaves it alone until the backoff is over, then picks it up
  expect(await dueAccountIds(deps())).not.toContain(id)
  clock = new Date(clock.getTime() + 11 * 60 * 1000)
  mock.clearFaults()
  expect(await dueAccountIds(deps())).toContain(id)
  expect(await syncAccount(deps(), id)).toMatchObject({ state: "done", imported: 1 })
})

test("one unreadable or oversized email never blocks the others", async () => {
  const { id } = await connectAccount(db, mock, "kim")
  mock.add({ id: "k1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT, padding: 6_000_000 })
  mock.add({ id: "k2", from: LINKEDIN_FROM, html: LINKEDIN_ALERT, attachment: "cv.pdf" })
  mock.add({ id: "k3", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  mock.fail({ match: /GET .*\/messages\/k3$/, status: 404, times: 1 })

  const result = await syncAccount(deps(), id)

  // k3 (newest) vanished, k1 is over the size cap and left alone, k2 is read without opening its attachment
  expect(result).toMatchObject({ state: "done", skipped: 2, imported: 1 })
  expect(tidied("k2")).toBe(true)
  expect([...mock.messages.get("k1")!.labelIds].sort()).toEqual(["INBOX", "UNREAD"])
})

test("a run is bounded: listing and processing have caps, the rest waits for the next run", async () => {
  const { id } = await connectAccount(db, mock, "lee", { senders: ["@bulk.example"] })
  const total = PROCESS_MAX + 10
  for (let i = 0; i < total; i++) {
    mock.add({
      id: `l${i}`,
      from: "Bulk <jobs@bulk.example>",
      html: `<div><a href="https://bulk.example/jobs/${i}">Software Engineer ${i}</a><div>Bulk Co ${i}</div></div>`,
    })
  }
  expect(total).toBeLessThanOrEqual(LIST_MAX)

  const first = await syncAccount(deps(), id)
  expect(first.imported).toBe(PROCESS_MAX)
  const second = await syncAccount(deps(), id)
  expect(second.imported).toBe(10)
  expect(await jobsOf("lee")).toHaveLength(total)
})

test("two syncs of one mailbox at once have one effect", async () => {
  const { id } = await connectAccount(db, mock, "max")
  mock.add({ id: "x1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered: () => void = () => {}
  const inside = new Promise<void>((resolve) => {
    entered = resolve
  })
  const slow = {
    ...h.runtime,
    fetch: async (...args: Parameters<typeof fetch>) => {
      entered()
      await held
      return h.runtime.fetch(...args)
    },
  } as GmailRuntime
  const first = syncAccount({ ...deps(), runtime: slow }, id)
  await inside
  const second = await syncAccount(deps(), id)
  release()
  expect([second.state, (await first).state]).toEqual(["busy", "done"])
  expect(await jobsOf("max")).toHaveLength(2)
  expect(await messagesOf("max")).toHaveLength(1)
})

test("sync now is allowed once a minute per user, and not without a connection", async () => {
  expect(await syncNow(deps(), "ned")).toBe("not_connected")
  await connectAccount(db, mock, "ned")
  const [a, b] = await Promise.all([syncNow(deps(), "ned"), syncNow(deps(), "ned")])
  expect([a, b].filter((r) => r === "too_soon")).toHaveLength(1)
  expect(await syncNow(deps(), "ned")).toBe("too_soon")
  clock = new Date(clock.getTime() + 61_000)
  expect(await syncNow(deps(), "ned")).toMatchObject({ state: "done" })
})

test("logs never carry a token, an address, a subject or job text", async () => {
  const spies = [spyOn(console, "error"), spyOn(console, "warn"), spyOn(console, "info"), spyOn(console, "log")].map(
    (s) => s.mockImplementation(() => {}),
  )
  try {
    const { id, refreshToken } = await connectAccount(db, mock, "oli", { email: "secret.person@example.test" })
    mock.add({ id: "z1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
    mock.fail({ match: /POST .*\/modify$/, status: 500, times: 3 })
    await syncAccount(deps(), id)
    mock.fail({ match: /GET .*\/messages$/, status: 429, times: 10 })
    await syncAccount(deps(), id)
    mock.refreshTokens.clear()
    h.tokens.delete(id)
    await syncAccount(deps(), id)
    const logged = captureConsole(spies)()
    expect(logged).not.toContain(refreshToken)
    for (const secret of [
      "rt-ana",
      "client-secret-value",
      "at-",
      "Acme Labs",
      "Senior Software Engineer",
      "Job alert",
      "jobalerts-noreply",
      "example.test",
      "linkedin.com",
      "Bearer",
    ]) {
      expect(logged, secret).not.toContain(secret)
    }
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
})
