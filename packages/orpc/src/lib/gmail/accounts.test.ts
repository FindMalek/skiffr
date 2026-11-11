import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test"
import { type Db, gmailAccount, gmailMessage, job } from "@skiffr/db"
import { eq } from "drizzle-orm"
import { completeConnect, disconnect } from "./accounts"
import { open } from "./crypto"
import { LINKEDIN_ALERT } from "./fixtures"
import { authorizeUrl } from "./google"
import { type MockGoogle, startMockGoogle } from "./mock-google"
import { DEFAULT_SENDERS } from "./senders"
import { consumeFlow, STATE_TTL_MS, safeReturnTo, startFlow } from "./state"
import { syncAccount } from "./sync"
import { connectDb, type Harness, harness, KEY, LINKEDIN_FROM, NOW } from "./test-support"

let db: Db
let drop: () => Promise<void>
let mock: MockGoogle
let h: Harness

beforeAll(async () => {
  const connected = await connectDb(["ana", "ben", "cy"])
  db = connected.db
  drop = connected.drop
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

/** What the browser does: open the consent url, let the mock "Google" redirect back with a code. */
async function consent(userId: string, now = NOW) {
  const { state, challenge } = await startFlow(db, KEY, userId, "/settings/gmail", now)
  const url = authorizeUrl(h.runtime, { state, challenge })
  const response = await fetch(url, { redirect: "manual" })
  const back = new URL(response.headers.get("location")!)
  return { url: new URL(url), state, code: back.searchParams.get("code")!, returned: back.searchParams.get("state")! }
}

const accountOf = async (userId: string) =>
  (await db.select().from(gmailAccount).where(eq(gmailAccount.userId, userId)))[0]

test("the consent asks for offline access with a fresh consent, one scope, PKCE and a signed state", async () => {
  const { url } = await consent("ana")
  const p = url.searchParams
  expect(p.get("access_type")).toBe("offline")
  expect(p.get("prompt")).toBe("consent")
  expect(p.get("scope")).toBe("https://www.googleapis.com/auth/gmail.modify")
  expect(p.get("code_challenge_method")).toBe("S256")
  expect(p.get("code_challenge")).toMatch(/^[\w-]{43}$/)
  expect(p.get("redirect_uri")).toBe("http://dashboard.test/api/gmail/callback")
  expect(url.href).not.toContain("client-secret-value")
})

test("connecting stores the refresh token sealed, makes the label and seeds the default senders", async () => {
  const flow = await consent("ana")
  const verified = await consumeFlow(db, KEY, flow.returned, "ana", NOW)
  expect(verified).not.toBeNull()

  expect(
    await completeConnect(db, h.runtime, { userId: "ana", code: flow.code, verifier: verified!.verifier, now: NOW }),
  ).toBe("connected")

  const account = (await accountOf("ana"))!
  const issued = [...mock.refreshTokens][0]!
  expect(account).toMatchObject({
    email: "ana.inbox@example.test",
    status: "active",
    scopes: "https://www.googleapis.com/auth/gmail.modify",
  })
  expect(account.refreshTokenEnc).not.toContain(issued)
  expect(open(KEY, account.refreshTokenEnc, "ana")).toBe(issued)
  expect(() => open(KEY, account.refreshTokenEnc, "ben")).toThrow()
  expect([...mock.labels.values()]).toEqual(["skiffr/jobs"])
  expect(account.labelId).toBe([...mock.labels.keys()][0]!)
  expect(account.senders).toEqual([...DEFAULT_SENDERS])
})

test("state works once, only for the user it was made for, only before it expires, and only untouched", async () => {
  const flow = await consent("ben")
  const [nonce, expiry, signature] = flow.state.split(".")
  expect(await consumeFlow(db, KEY, `${nonce}.${expiry}.${signature!.slice(0, -2)}xx`, "ben", NOW)).toBeNull()
  expect(await consumeFlow(db, KEY, `${nonce}x.${expiry}.${signature}`, "ben", NOW)).toBeNull()
  expect(await consumeFlow(db, KEY, `${nonce}.${Number(expiry) + 600}.${signature}`, "ben", NOW)).toBeNull()
  expect(await consumeFlow(db, KEY, flow.state, "cy", NOW)).toBeNull()
  expect(await consumeFlow(db, KEY, "", "ben", NOW)).toBeNull()
  expect(await consumeFlow(db, KEY, flow.state, "ben", NOW)).not.toBeNull()
  // replayed
  expect(await consumeFlow(db, KEY, flow.state, "ben", NOW)).toBeNull()

  const late = await consent("ben")
  expect(await consumeFlow(db, KEY, late.state, "ben", new Date(NOW.getTime() + STATE_TTL_MS + 1000))).toBeNull()

  // starting again replaces the earlier flow
  const first = await consent("cy")
  const second = await consent("cy")
  expect(await consumeFlow(db, KEY, first.state, "cy", NOW)).toBeNull()
  expect(await consumeFlow(db, KEY, second.state, "cy", NOW)).not.toBeNull()
})

test("a code is only good with the verifier of its own flow", async () => {
  const flow = await consent("ben")
  const other = await consent("cy")
  const stolen = await consumeFlow(db, KEY, other.state, "cy", NOW)
  expect(
    await completeConnect(db, h.runtime, { userId: "ben", code: flow.code, verifier: stolen!.verifier, now: NOW }),
  ).toBe("exchange_failed")
  expect(await accountOf("ben")).toBeUndefined()
})

test("return paths are exact: anything else falls back to the settings page", () => {
  expect(safeReturnTo("/settings/gmail")).toBe("/settings/gmail")
  for (const bad of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/settings/gmail/../../x",
    "/settings/gmail?x=1",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])
    expect(safeReturnTo(bad as string | null), String(bad)).toBe("/settings/gmail")
})

test("a grant without a refresh token or without the scope is revoked again and stores nothing", async () => {
  mock.omitRefreshToken = true
  let flow = await consent("ben")
  let verified = await consumeFlow(db, KEY, flow.returned, "ben", NOW)
  expect(
    await completeConnect(db, h.runtime, { userId: "ben", code: flow.code, verifier: verified!.verifier, now: NOW }),
  ).toBe("no_refresh_token")

  mock.omitRefreshToken = false
  mock.grantedScope = "https://www.googleapis.com/auth/userinfo.email"
  flow = await consent("ben")
  verified = await consumeFlow(db, KEY, flow.returned, "ben", NOW)
  expect(
    await completeConnect(db, h.runtime, { userId: "ben", code: flow.code, verifier: verified!.verifier, now: NOW }),
  ).toBe("scope_missing")
  expect(mock.revoked.length).toBe(2)
  expect(await accountOf("ben")).toBeUndefined()
})

test("a mailbox already connected by another skiffr user is refused, and a reconnect keeps the senders", async () => {
  const connect = async (userId: string) => {
    const flow = await consent(userId)
    const verified = await consumeFlow(db, KEY, flow.returned, userId, NOW)
    return completeConnect(db, h.runtime, { userId, code: flow.code, verifier: verified!.verifier, now: NOW })
  }
  expect(await connect("ana")).toBe("connected")
  expect(await connect("ben")).toBe("already_connected")
  expect(await accountOf("ben")).toBeUndefined()
  expect(mock.revoked.length).toBe(1)

  await db
    .update(gmailAccount)
    .set({ status: "needs_reconnect", lastError: "auth", senders: ["@mine.example"] })
    .where(eq(gmailAccount.userId, "ana"))
  expect(await connect("ana")).toBe("connected")
  expect(await accountOf("ana")).toMatchObject({ status: "active", lastError: null, senders: ["@mine.example"] })
})

test("disconnecting revokes the grant at google and deletes the account and its records, but not the queued jobs", async () => {
  mock.setEmail("cy.inbox@example.test")
  const flow = await consent("cy")
  const verified = await consumeFlow(db, KEY, flow.returned, "cy", NOW)
  await completeConnect(db, h.runtime, { userId: "cy", code: flow.code, verifier: verified!.verifier, now: NOW })
  const account = (await accountOf("cy"))!
  mock.add({ id: "q1", from: LINKEDIN_FROM, html: LINKEDIN_ALERT })
  await syncAccount({ db, runtime: h.runtime, now: () => NOW, tokens: h.tokens }, account.id)
  expect(await db.select().from(gmailMessage).where(eq(gmailMessage.userId, "cy"))).toHaveLength(1)
  const issued = [...mock.refreshTokens][0]!

  expect(await disconnect(db, h.runtime, "cy")).toEqual({ revoked: true })

  expect(mock.revoked).toContain(issued)
  expect(mock.refreshTokens.has(issued)).toBe(false)
  expect(await accountOf("cy")).toBeUndefined()
  expect(await db.select().from(gmailMessage).where(eq(gmailMessage.userId, "cy"))).toEqual([])
  expect(await db.select().from(job).where(eq(job.userId, "cy"))).toHaveLength(2)
  expect(await disconnect(db, h.runtime, "cy")).toBeNull()
})
