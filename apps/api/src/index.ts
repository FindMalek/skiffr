import { resolveEmbeddingModel, resolveModel } from "@skiffr/ai"
import { createAuth } from "@skiffr/auth"
import { createDb } from "@skiffr/db"
import { runMigrations } from "@skiffr/db/migrate"
import { seedDemo } from "@skiffr/db/seed"
import { loadApiEnv } from "@skiffr/env/api"
import { RateLimiter } from "@skiffr/orpc"
import { createCvRuntime } from "@skiffr/orpc/cv"
import { advisoryLeader, createScheduler, LOCKS } from "@skiffr/orpc/gmail"
import { createWatchRuntime, createWatchScheduler } from "@skiffr/orpc/watch"
import { createStorage } from "@skiffr/storage"
import { ensureAdmin } from "./admin"
import { gmailFromEnv } from "./gmail-runtime"
import { createServer } from "./server"

const WATCH_TICK_MS = 5 * 60_000

const env = loadApiEnv()
const db = createDb(env.DATABASE_URL)
await runMigrations(db)

const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  dashboardUrl: env.DASHBOARD_URL,
  trustedOrigins: [env.WEB_URL, env.DASHBOARD_URL],
  github:
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined,
  secureCookies: env.NODE_ENV === "production",
})

const adminId = await ensureAdmin(db, auth, env.ADMIN_EMAIL, env.ADMIN_PASSWORD)
if (env.SEED === "demo" && (await seedDemo(db, { ownerId: adminId }))) console.info("seeded demo data")

const extensionOrigins = env.EXTENSION_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
if (env.NODE_ENV === "production" && !extensionOrigins?.length) {
  console.warn("EXTENSION_ORIGINS is not set: any chrome-extension:// origin may call /rpc and /v1 with a token")
}

const gmail = gmailFromEnv(env)
const watch = createWatchRuntime({ refreshMinutes: env.WATCH_REFRESH_MINUTES })
const cv = env.CV_ENCRYPTION_KEY ? createCvRuntime({ encryptionKey: env.CV_ENCRYPTION_KEY }) : null

const fetch = createServer(
  {
    db,
    auth,
    now: () => new Date(),
    config: {
      deployEnv: env.DEPLOY_ENV,
      githubAuth: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      githubRepo: env.GITHUB_REPO,
      githubToken: env.GITHUB_TOKEN,
    },
    storage: createStorage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      prefix: env.DEPLOY_ENV.startsWith("pr-") ? `${env.DEPLOY_ENV}/` : "",
    }),
    model: resolveModel(env.AI_MODEL, env),
    embeddingModel: resolveEmbeddingModel(env),
    gmail,
    watch,
    cv,
    limits: new RateLimiter(),
    aiBudget: { dailyCalls: env.AI_DAILY_CALLS, dailyTokens: env.AI_DAILY_TOKENS },
  },
  {
    publicUrl: env.API_PUBLIC_URL,
    dashboardUrl: env.DASHBOARD_URL,
    extensionOrigins,
  },
)

const server = Bun.serve({ port: env.PORT, hostname: "0.0.0.0", fetch })
console.info(`api on :${server.port} (${env.DEPLOY_ENV})`)

// Mail is read in this process, by one replica at a time (an advisory lock picks it). Without the Google client nothing runs.
const scheduler =
  gmail && env.GMAIL_SCHEDULER === "on"
    ? createScheduler(
        { db, runtime: gmail.runtime, now: () => new Date(), tokens: gmail.tokens },
        { leader: advisoryLeader(db), intervalMs: gmail.runtime.syncIntervalMinutes * 60_000 },
      )
    : null
scheduler?.start()
console.info(
  scheduler
    ? `gmail import every ${gmail?.runtime.syncIntervalMinutes} min`
    : `gmail import ${gmail ? "runs from an external job" : "is not configured"}`,
)

const watcher =
  env.WATCH_SCHEDULER === "on"
    ? createWatchScheduler(
        { db, runtime: watch, now: () => new Date() },
        { leader: advisoryLeader(db, LOCKS.watch), intervalMs: WATCH_TICK_MS },
      )
    : null
watcher?.start()
console.info(`job source watcher ${watcher ? `every ${env.WATCH_REFRESH_MINUTES} min per source` : "is off"}`)

let stopping = false
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    await scheduler?.stop()
    await watcher?.stop()
    await server.stop()
    await db.close()
    process.exit(0)
  })
}
