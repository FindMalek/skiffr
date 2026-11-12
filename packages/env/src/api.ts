import { z } from "zod"
import { parseEnv } from "./parse"

const optional = z.string().optional()

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  /** "production", "pr-<n>" for previews, or "local". */
  DEPLOY_ENV: z.string().default("local"),
  DATABASE_URL: z.string().min(1),
  SEED: z.enum(["none", "demo"]).default("demo"),

  /** Public origins: the api's own, and the two apps that proxy to it. */
  API_PUBLIC_URL: z.url().default("http://localhost:3001"),
  WEB_URL: z.url().default("http://localhost:3000"),
  DASHBOARD_URL: z.url().default("http://localhost:3002"),

  /** Comma separated `chrome-extension://<id>` origins allowed to call /rpc and /v1 with a token; unset allows any extension. */
  EXTENSION_ORIGINS: optional,

  BETTER_AUTH_SECRET: z.string().min(32),
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  /** First admin, created (or its password reset) on every start. */
  ADMIN_EMAIL: optional,
  ADMIN_PASSWORD: optional,

  /** Public repo shown on the landing page (owner/name). */
  GITHUB_REPO: optional,
  GITHUB_TOKEN: optional,

  S3_ENDPOINT: optional,
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,

  /**
   * Gmail job-email import. Off until the Google OAuth client and the key are all set (see the gmail docs page).
   * The key seals refresh tokens: 32 random bytes, base64 (`openssl rand -base64 32`).
   */
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GMAIL_ENCRYPTION_KEY: optional,
  /** Defaults to `<DASHBOARD_URL>/api/gmail/callback`, so the session cookie rides along. Must match the Google client. */
  GOOGLE_REDIRECT_URI: z.url().optional(),
  /** `off` keeps the api from reading mail itself, for running `bun src/gmail-sync-cli.ts` as an external scheduled job. */
  GMAIL_SCHEDULER: z.enum(["on", "off"]).default("on"),
  GMAIL_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  /** `off` keeps the api from fetching watched job sources itself. "Run now" still works. */
  WATCH_SCHEDULER: z.enum(["on", "off"]).default("on"),
  /** How long a source waits between fetches when all goes well. */
  WATCH_REFRESH_MINUTES: z.coerce.number().int().min(15).max(1440).default(60),

  /** Reactive Resume tailoring. Off until this is set: it seals the stored api keys (32 random bytes, base64, `openssl rand -base64 32`). */
  CV_ENCRYPTION_KEY: optional,

  AI_MODEL: z.string().default("groq:openai/gpt-oss-120b"),
  GROQ_API_KEY: optional,
  OPENAI_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  /** Per user and UTC day, kept in the database so it holds across restarts and replicas. 0 means no limit. */
  AI_DAILY_CALLS: z.coerce.number().int().min(0).default(300),
  AI_DAILY_TOKENS: z.coerce.number().int().min(0).default(1_000_000),
})

const GMAIL_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_ENCRYPTION_KEY"] as const

const isRandomKey = (value: string) =>
  /^[A-Za-z0-9+/]{43}=$/.test(value) && new Set(Buffer.from(value, "base64")).size >= 8

const apiSchema = schema.superRefine((env, ctx) => {
  const set = GMAIL_KEYS.filter((key) => env[key])
  if (set.length > 0 && set.length < GMAIL_KEYS.length) {
    for (const key of GMAIL_KEYS.filter((key) => !env[key]))
      ctx.addIssue({ code: "custom", path: [key], message: `required once ${set.join(" or ")} is set (gmail import)` })
  }
  for (const key of ["GMAIL_ENCRYPTION_KEY", "CV_ENCRYPTION_KEY"] as const) {
    if (env[key] && !isRandomKey(env[key])) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "must be 32 random bytes, base64 encoded (openssl rand -base64 32)",
      })
    }
  }
})

export type ApiEnv = z.infer<typeof apiSchema>
export const loadApiEnv = (source?: Record<string, string | undefined>) => parseEnv(apiSchema, source)
