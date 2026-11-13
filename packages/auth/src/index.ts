import type { Db } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { APIError, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createAuthMiddleware } from "better-auth/api"
import { admin, magicLink } from "better-auth/plugins"

export interface AuthConfig {
  db: Db
  secret: string
  /** Public url of the dashboard: auth is served under its `/api/auth` proxy, so cookies stay first-party. */
  dashboardUrl: string
  trustedOrigins: string[]
  github?: { clientId: string; clientSecret: string }
  secureCookies: boolean
  /** Leave unset for better-auth's default: on in production only. */
  rateLimit?: boolean
  /** Called with the link to email; unset means those flows stay off. */
  sendVerification?: (user: { email: string; name: string }, url: string) => Promise<unknown>
  sendResetPassword?: (user: { email: string; name: string }, url: string) => Promise<unknown>
  sendMagicLink?: (email: string, url: string) => Promise<unknown>
}

/** Set by the api from the connection and its trusted proxies, never taken from a client: it is the only header better-auth reads the client ip from. */
export const CLIENT_IP_HEADER = "x-skiffr-client-ip"
/** Stands in for a client whose address could not be told (a documentation address, never a real one): they share one bucket that is looser than a real address's. */
export const UNKNOWN_CLIENT_IP = "192.0.2.1"
const UNKNOWN_CLIENT_FACTOR = 10

/** The same limit for everyone, and a looser one for the shared bucket of clients with no address, so they can't lock each other out. */
const perClient =
  (window: number, max: number) =>
  (request: Request): { window: number; max: number } => ({
    window,
    max: request.headers.get(CLIENT_IP_HEADER) === UNKNOWN_CLIENT_IP ? max * UNKNOWN_CLIENT_FACTOR : max,
  })

/** Longest display name sign up takes: it is open to anyone and stored as sent. The dashboard form holds the same cap. */
export const NAME_MAX = 100

const quiet = (task: Promise<unknown>) => task.catch((error) => console.error("[auth] email failed", error))

export function createAuth(config: AuthConfig) {
  const { sendVerification, sendResetPassword, sendMagicLink } = config
  return betterAuth({
    baseURL: config.dashboardUrl,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(config.db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // A reset is how a hijacked account is recovered: sessions signed in with the old password must end.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: sendResetPassword
        ? async ({ user, url }) => void quiet(sendResetPassword(user, url))
        : undefined,
    },
    emailVerification: sendVerification
      ? { sendOnSignUp: true, sendVerificationEmail: async ({ user, url }) => void quiet(sendVerification(user, url)) }
      : undefined,
    socialProviders: config.github ? { github: config.github } : undefined,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const name = (ctx.body as { name?: unknown } | undefined)?.name
        if (ctx.path === "/sign-up/email" && typeof name === "string" && name.length > NAME_MAX) {
          throw new APIError("BAD_REQUEST", { message: "Name too long", code: "NAME_TOO_LONG" })
        }
      }),
    },
    plugins: [
      admin(),
      ...(sendMagicLink
        ? [magicLink({ sendMagicLink: async ({ email, url }) => void quiet(sendMagicLink(email, url)) })]
        : []),
    ],
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    rateLimit: {
      enabled: config.rateLimit,
      storage: "database",
      customRules: {
        "/sign-in/email": perClient(60, 10),
        "/sign-up/email": perClient(60, 5),
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  })
}

export type Auth = ReturnType<typeof createAuth>
export type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>
