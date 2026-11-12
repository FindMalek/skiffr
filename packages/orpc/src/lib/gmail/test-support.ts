import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { type Db, gmailAccount, user } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { createTestDb, strictDateSerializers } from "@skiffr/db/test-db"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { seal } from "./crypto"
import type { GmailRuntime } from "./google"
import type { MockGoogle } from "./mock-google"
import { DEFAULT_SENDERS } from "./senders"
import { TokenCache } from "./sync"

const DRIZZLE = new URL("../../../../db/drizzle", import.meta.url).pathname

export const KEY = Buffer.alloc(32, 9)
export const NOW = new Date("2026-11-10T10:00:00Z")

/** TEST_DATABASE_URL runs on a fresh `skiffr_test_*` database of that postgres, otherwise in-process pglite with strict date handling. */
export async function connectDb(ids: string[]): Promise<{ db: Db; drop: () => Promise<void>; real: boolean }> {
  const url = process.env.TEST_DATABASE_URL
  let db: Db
  let drop = async () => {}
  if (url) {
    const test = await createTestDb(url)
    db = test.db
    drop = test.drop
  } else {
    const pg = drizzle(new PGlite({ extensions: { vector }, serializers: strictDateSerializers }), { schema })
    await migrate(pg, { migrationsFolder: DRIZZLE })
    db = pg as unknown as Db
  }
  const now = new Date()
  if (ids.length > 0) {
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@test.dev`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
  }
  return { db, drop, real: Boolean(url) }
}

export interface Harness {
  runtime: GmailRuntime
  tokens: TokenCache
  /** Every url the code under test asked for, in order. */
  urls: string[]
  sleeps: number[]
  /** Runs before a request goes out, with the method and url. */
  onRequest: (hook: ((method: string, url: string) => Promise<void> | void) | null) => void
}

export function harness(mock: MockGoogle): Harness {
  let hook: ((method: string, url: string) => Promise<void> | void) | null = null
  const urls: string[] = []
  const sleeps: number[] = []
  const runtime: GmailRuntime = {
    clientId: "client-id.test",
    clientSecret: "client-secret-value",
    redirectUri: "http://dashboard.test/api/gmail/callback",
    dashboardUrl: "http://dashboard.test",
    key: KEY,
    syncIntervalMinutes: 15,
    endpoints: mock.endpoints,
    fetch: (async (input: Request | URL | string, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      await hook?.(init?.method ?? "GET", url)
      return fetch(input, init)
    }) as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
  }
  return {
    runtime,
    tokens: new TokenCache(),
    urls,
    sleeps,
    onRequest(next) {
      hook = next
    },
  }
}

/** A connected mailbox as the callback leaves it, without going through the consent. */
export async function connectAccount(
  db: Db,
  mock: MockGoogle,
  userId: string,
  options: { senders?: string[]; email?: string; refreshToken?: string } = {},
): Promise<{ id: string; refreshToken: string }> {
  const refreshToken = options.refreshToken ?? `rt-${userId}-secret`
  mock.refreshTokens.add(refreshToken)
  const [row] = await db
    .insert(gmailAccount)
    .values({
      userId,
      email: options.email ?? `${userId}.inbox@example.test`,
      refreshTokenEnc: seal(KEY, refreshToken, userId),
      scopes: "https://www.googleapis.com/auth/gmail.modify",
      senders: options.senders ?? [...DEFAULT_SENDERS],
    })
    .returning({ id: gmailAccount.id })
  return { id: row!.id, refreshToken }
}

export const LINKEDIN_FROM = "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>"
export const INDEED_FROM = "Indeed <alert@indeed.com>"

/** Collects everything the code logs, so a test can prove none of it carries a token or mail. */
export function captureConsole(spies: Array<{ mock: { calls: unknown[][] } }>): () => string {
  return () =>
    spies
      .map((spy) =>
        JSON.stringify(spy.mock.calls, (_, value) =>
          value instanceof Error ? { message: value.message, stack: value.stack } : value,
        ),
      )
      .join("\n")
}
