import { expect, test } from "bun:test"
import { loadApiEnv } from "@skiffr/env/api"
import { gmailFromEnv } from "./gmail-runtime"

const BASE = { DATABASE_URL: "postgres://x/y", BETTER_AUTH_SECRET: "s".repeat(32) }
const KEY = Buffer.alloc(32, 1).toString("base64")

test("without the google client there is no gmail service, and so no scheduler", () => {
  expect(gmailFromEnv(loadApiEnv(BASE))).toBeNull()
})

test("a half configured gmail fails at start, and a key of the wrong size too", () => {
  expect(() => loadApiEnv({ ...BASE, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_SECRET/)
  expect(() =>
    loadApiEnv({ ...BASE, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", GMAIL_ENCRYPTION_KEY: "short" }),
  ).toThrow(/32 random bytes/)
})

test("configured, the redirect uri goes through the dashboard proxy so the session cookie arrives", () => {
  const env = loadApiEnv({
    ...BASE,
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "s",
    GMAIL_ENCRYPTION_KEY: KEY,
    DASHBOARD_URL: "https://app.example.com",
  })
  const service = gmailFromEnv(env)!
  expect(service.runtime.redirectUri).toBe("https://app.example.com/api/gmail/callback")
  expect(service.runtime.syncIntervalMinutes).toBe(15)
  const custom = gmailFromEnv(
    loadApiEnv({
      ...BASE,
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "s",
      GMAIL_ENCRYPTION_KEY: KEY,
      GOOGLE_REDIRECT_URI: "https://x.example/cb",
    }),
  )!
  expect(custom.runtime.redirectUri).toBe("https://x.example/cb")
})
