import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test"
import { type Db, job } from "@skiffr/db"
import { eq } from "drizzle-orm"
import { LINKEDIN_ALERT } from "./fixtures"
import { advisoryLeader, type Leader } from "./leader"
import { type MockGoogle, startMockGoogle } from "./mock-google"
import { createScheduler } from "./scheduler"
import { connectAccount, connectDb, type Harness, harness, LINKEDIN_FROM, NOW } from "./test-support"

let db: Db
let drop: () => Promise<void>
let real: boolean
let mock: MockGoogle
let h: Harness

beforeAll(async () => {
  const connected = await connectDb(["ana", "ben"])
  db = connected.db
  drop = connected.drop
  real = connected.real
})
afterAll(async () => {
  await drop()
})
beforeEach(async () => {
  mock = await startMockGoogle()
  h = harness(mock)
})
afterEach(async () => {
  await mock.close()
})

const deps = () => ({ db, runtime: h.runtime, now: () => NOW, tokens: h.tokens })
const fakeLeader = (leads: boolean): Leader & { released: number } => ({
  released: 0,
  tryAcquire: async () => leads,
  async release() {
    this.released++
  },
})

test("only the leading replica reads mail, and stopping waits for the mailbox in progress then gives up the lead", async () => {
  await connectAccount(db, mock, "ana")
  mock.add({ id: "s1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })

  const follower = createScheduler(deps(), { leader: fakeLeader(false), intervalMs: 60_000 })
  expect(await follower.tick()).toBe(0)
  expect(await db.select().from(job).where(eq(job.userId, "ana"))).toEqual([])

  const leader = fakeLeader(true)
  const scheduler = createScheduler(deps(), { leader, intervalMs: 60_000 })
  let slowed = false
  h.onRequest(async (_method, url) => {
    if (!slowed && url.endsWith("/token")) {
      slowed = true
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
  })
  const running = scheduler.tick()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await scheduler.stop()
  expect(await running).toBe(1)
  expect(leader.released).toBe(1)
  expect(await db.select().from(job).where(eq(job.userId, "ana"))).toHaveLength(2)
  // once stopped, a late tick does nothing
  expect(await scheduler.tick()).toBe(0)
})

test("a failing pass is logged without detail and the scheduler keeps going", async () => {
  const broken = {
    tryAcquire: async () => {
      throw new Error("secret detail")
    },
    release: async () => {},
  }
  const scheduler = createScheduler(deps(), { leader: broken, intervalMs: 60_000 })
  const original = console.error
  const lines: string[] = []
  console.error = (...args: unknown[]) => void lines.push(JSON.stringify(args))
  try {
    expect(await scheduler.tick()).toBe(0)
    expect(await scheduler.tick()).toBe(0)
  } finally {
    console.error = original
  }
  expect(lines).toHaveLength(2)
  expect(lines.join("")).not.toContain("secret detail")
})

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "the postgres advisory lock lets one replica lead and passes the lead on when it lets go",
  async () => {
    expect(real).toBe(true)
    const first = advisoryLeader(db)
    const second = advisoryLeader(db)
    expect(await first.tryAcquire()).toBe(true)
    expect(await first.tryAcquire()).toBe(true)
    expect(await second.tryAcquire()).toBe(false)
    await first.release()
    expect(await second.tryAcquire()).toBe(true)
    expect(await first.tryAcquire()).toBe(false)
    await second.release()
  },
)
