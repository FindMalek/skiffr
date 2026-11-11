import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test"
import type { Auth } from "@skiffr/auth"
import { type Db, gmailAccount } from "@skiffr/db"
import { TokenCache } from "@skiffr/orpc/gmail"
import { type MockGoogle, startMockGoogle } from "@skiffr/orpc/gmail-mock"
import { connectDb, type Harness, harness } from "@skiffr/orpc/gmail-test"
import { eq } from "drizzle-orm"
import { createServer } from "./server"

const DASHBOARD = "http://dashboard.test"
let db: Db
let drop: () => Promise<void>
let mock: MockGoogle
let h: Harness
let server: (request: Request) => Promise<Response>
let unconfigured: (request: Request) => Promise<Response>

const auth = {
  handler: async () => new Response(null, { status: 204 }),
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = /u=(\w+)/.exec(headers.get("cookie") ?? "")?.[1]
      return id ? { user: { id, name: id, email: `${id}@test.dev` } } : null
    },
  },
} as unknown as Auth

beforeAll(async () => {
  const connected = await connectDb(["ana", "ben"])
  db = connected.db
  drop = connected.drop
})
afterAll(async () => {
  await drop()
  await mock?.close()
})
beforeEach(async () => {
  await mock?.close()
  mock = await startMockGoogle()
  h = harness(mock)
  const base = {
    db,
    auth,
    now: () => new Date(),
    config: { deployEnv: "test", githubAuth: false },
    storage: null,
    model: null,
    embeddingModel: null,
  }
  server = createServer(
    { ...base, gmail: { runtime: h.runtime, tokens: new TokenCache() } },
    { publicUrl: "http://api.test", dashboardUrl: DASHBOARD },
  )
  unconfigured = createServer({ ...base, gmail: null }, { publicUrl: "http://api.test", dashboardUrl: DASHBOARD })
})

const get = (path: string, headers: Record<string, string> = {}, handler = server) =>
  handler(new Request(`http://api.test${path}`, { headers, redirect: "manual" }))
const as = (id: string) => ({ cookie: `u=${id}` })

/** connect → the mock google's consent → the callback url the browser would be sent back to */
async function consent(user: string, query = "") {
  const connect = await get(`/gmail/connect${query}`, as(user))
  const google = await fetch(connect.headers.get("location")!, { redirect: "manual" })
  const back = new URL(google.headers.get("location")!)
  return { connect, callback: `/gmail/callback${back.search}`, back }
}

test("connect needs a cookie session, refuses tokens and other methods, and says so when not configured", async () => {
  const anonymous = await get("/gmail/connect")
  expect([anonymous.status, anonymous.headers.get("location")]).toEqual([302, `${DASHBOARD}/sign-in`])
  expect((await get("/gmail/connect", { authorization: "Bearer skp_x", ...as("ana") })).status).toBe(403)
  expect((await get("/gmail/callback", { authorization: "Bearer skp_x", ...as("ana") })).status).toBe(403)
  const post = await server(new Request("http://api.test/gmail/connect", { method: "POST", headers: as("ana") }))
  expect(post.status).toBe(405)
  expect((await get("/gmail/connect", as("ana"), unconfigured)).status).toBe(404)
})

test("connect can be started from skiffr itself or by typing the address, not from another site", async () => {
  for (const site of ["cross-site", "same-site"])
    expect((await get("/gmail/connect", { ...as("ana"), "sec-fetch-site": site })).status, site).toBe(403)
  for (const site of ["same-origin", "none"])
    expect((await get("/gmail/connect", { ...as("ana"), "sec-fetch-site": site })).status, site).toBe(302)
})

test("the whole consent: connect, google, callback, back on the settings page with a status and nothing secret in the url", async () => {
  const logs = [spyOn(console, "error"), spyOn(console, "warn"), spyOn(console, "info"), spyOn(console, "log")].map(
    (s) => s.mockImplementation(() => {}),
  )
  try {
    const { connect, callback } = await consent("ana")
    const consentUrl = new URL(connect.headers.get("location")!)
    expect(consentUrl.origin + consentUrl.pathname).toBe(`${mock.url}/auth`)
    expect(consentUrl.searchParams.get("prompt")).toBe("consent")
    expect(connect.headers.get("cache-control")).toBe("no-store")

    const done = await get(callback, as("ana"))
    expect(done.status).toBe(302)
    const location = new URL(done.headers.get("location")!)
    expect(location.origin + location.pathname).toBe(`${DASHBOARD}/settings/gmail`)
    expect(location.search).toBe("?gmail=connected")
    const [account] = await db.select().from(gmailAccount).where(eq(gmailAccount.userId, "ana"))
    expect(account).toMatchObject({ email: "ana.inbox@example.test", status: "active" })
    expect(account!.labelId).toBeTruthy()

    const replay = await get(callback, as("ana"))
    expect(new URL(replay.headers.get("location")!).search).toBe("?gmail=invalid_state")

    const printed = logs.map((s) => JSON.stringify(s.mock.calls)).join("")
    expect(printed).not.toContain(new URL(`http://x${callback}`).searchParams.get("code")!)
    expect(printed).not.toContain([...mock.refreshTokens][0]!)
  } finally {
    for (const spy of logs) spy.mockRestore()
  }
})

test("a callback for another user's flow, without a session, or with a tampered state does nothing", async () => {
  mock.setEmail("ben.inbox@example.test")
  const { callback } = await consent("ben")
  const other = await get(callback, as("ana"))
  expect(new URL(other.headers.get("location")!).search).toBe("?gmail=invalid_state")
  const anonymous = await get(callback)
  expect(anonymous.headers.get("location")).toBe(`${DASHBOARD}/sign-in`)
  const url = new URL(`http://x${callback}`)
  url.searchParams.set("state", `${url.searchParams.get("state")}x`)
  expect(new URL((await get(`/gmail/callback${url.search}`, as("ben"))).headers.get("location")!).search).toBe(
    "?gmail=invalid_state",
  )
  expect(await db.select().from(gmailAccount).where(eq(gmailAccount.userId, "ben"))).toEqual([])
  // the genuine one still works for its own user: the failed tries did not use it up
  expect(new URL((await get(callback, as("ben"))).headers.get("location")!).search).toBe("?gmail=connected")
})

test("a returnTo that is not one of ours never leaves the dashboard", async () => {
  mock.setEmail("ana2.inbox@example.test")
  for (const returnTo of ["https://evil.test/x", "//evil.test", "/settings/gmail/../../x"]) {
    const { callback } = await consent("ana", `?returnTo=${encodeURIComponent(returnTo)}`)
    const location = new URL((await get(callback, as("ana"))).headers.get("location")!)
    expect(location.origin).toBe(DASHBOARD)
    expect(location.pathname).toBe("/settings/gmail")
  }
})

test("cancelling at google comes back as denied and stores nothing", async () => {
  mock.denyConsent = true
  mock.setEmail("denied.inbox@example.test")
  const { callback } = await consent("ben")
  expect(callback).toContain("error=access_denied")
  expect(new URL((await get(callback, as("ben"))).headers.get("location")!).search).toBe("?gmail=denied")
})

test("disconnect is an rpc call that needs the csrf header, and revokes the grant", async () => {
  const disconnect = (headers: Record<string, string>) =>
    server(
      new Request("http://api.test/rpc/gmail/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({}),
      }),
    )
  expect((await disconnect(as("ana"))).status).toBe(403)
  const ok = await disconnect({ ...as("ana"), "x-csrf-token": "orpc" })
  expect(ok.status).toBe(200)
  expect((await ok.json()).json).toEqual({ revoked: true })
  expect(mock.revoked).toHaveLength(1)
  expect(await db.select().from(gmailAccount).where(eq(gmailAccount.userId, "ana"))).toEqual([])
})
