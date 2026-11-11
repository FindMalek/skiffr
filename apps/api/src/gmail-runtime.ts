import type { ApiEnv } from "@skiffr/env/api"
import type { GmailService } from "@skiffr/orpc"
import { GOOGLE_ENDPOINTS, parseKey, TokenCache } from "@skiffr/orpc/gmail"

/** Null (and so "not configured" in the dashboard, and no scheduler) unless the Google client and the encryption key are all set. */
export function gmailFromEnv(env: ApiEnv): GmailService | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GMAIL_ENCRYPTION_KEY) return null
  return {
    runtime: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI ?? new URL("/api/gmail/callback", env.DASHBOARD_URL).href,
      dashboardUrl: env.DASHBOARD_URL,
      key: parseKey(env.GMAIL_ENCRYPTION_KEY),
      syncIntervalMinutes: env.GMAIL_SYNC_INTERVAL_MINUTES,
      endpoints: GOOGLE_ENDPOINTS,
      fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    tokens: new TokenCache(),
  }
}
