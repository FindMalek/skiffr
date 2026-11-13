import { z } from "zod"
import { parseEnv } from "./parse"

const optional = z.string().optional()

/** Digits only, so a stray space or "1e3" is an error and never reads as 0, and within what an int4 column holds. */
const count = (fallback: number, max = 2_147_483_647) =>
  z
    .string()
    .regex(/^\d+$/, "must be a whole number, digits only")
    .transform(Number)
    .pipe(z.number().int().max(max))
    .default(fallback)

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  /** "production", "pr-<n>" for previews, or "local". The preview seed only runs for exactly `local` or `pr-<n>`. */
  DEPLOY_ENV: z.string().default("local"),
  DATABASE_URL: z.string().min(1),
  /** `demo` seeds the notes example into an empty database, `preview` the full demo dataset (previews and local dev only, see the seeding docs). */
  SEED: z.enum(["none", "demo", "preview"]).default("demo"),
  /** The password of the seeded preview users. Only read for `SEED=preview`; the default is documented and public, so it only works where the seed itself is allowed. */
  SEED_DEMO_PASSWORD: z.string().min(10).max(128).optional(),
  /** `on` wipes the preview users and their data before seeding them again, so the dates move to now. */
  SEED_RESET: z.enum(["on", "off"]).default("off"),
  /** Where the seed writes its links json (credentials and test urls) for the preview tooling. Unset writes no file. */
  SEED_LINKS_PATH: optional,
  /** The Reactive Resume the seeded cv connection points at: a mock or a real instance. */
  SEED_CV_URL: z.url().optional(),
  /** Base url of the playground app: queued seeded jobs and their site profiles point at it. Unset uses example.invalid hosts. */
  PLAYGROUND_URL: z.url().optional(),
  /** Lets `SEED=preview` run on a production build (NODE_ENV=production) when `DEPLOY_ENV` is `local`. Any other `DEPLOY_ENV` than `local` or `pr-<n>` is refused regardless. */
  SEED_ALLOW_PRODUCTION_BUILD: z.enum(["yes"]).optional(),

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
  AI_DAILY_CALLS: count(600),
  AI_DAILY_TOKENS: count(1_000_000),
  /** Model calls the whole server may make per UTC day, all users together: the guard against many free accounts. 0 means no limit. */
  AI_GLOBAL_DAILY_CALLS: count(0),

  /** Optional, all off until set. GlitchTip (Sentry compatible) error reports: the project's dsn. */
  GLITCHTIP_DSN: z.url().optional(),
  /** OTLP/HTTP base up to the org, e.g. `http://openobserve:5080/api/default`. Request logs, metrics and model call spans go here. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  /** `key=value,key=value`, e.g. `authorization=Basic <base64>,stream-name=skiffr`. A secret. */
  OTEL_EXPORTER_OTLP_HEADERS: optional,
  /** Umami base url and website id for the api's own product events (counts only, no ids). */
  UMAMI_URL: z.url().optional(),
  UMAMI_WEBSITE_ID: z.uuid().optional(),
  /** `true` adds prompts and answers to model call spans. They hold personal data: leave it off unless the collector is yours and you need it. */
  AI_TRACE_CAPTURE_CONTENT: z.enum(["true", "false"]).default("false"),

  /** Where the api finds the client address: the header the proxy in front sets, and how many proxies append to it. 0 ignores the header and uses the connection's own address. */
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]+$/i)
    .default("x-forwarded-for"),
  TRUSTED_PROXY_COUNT: count(1, 10),
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
