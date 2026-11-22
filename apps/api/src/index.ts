import { resolveEmbeddingModel, resolveModel } from "@skiffr/ai"
import { createAuth } from "@skiffr/auth"
import { createDb } from "@skiffr/db"
import { runMigrations } from "@skiffr/db/migrate"
import { loadApiEnv } from "@skiffr/env/api"
import { configFromEnv, createObservability, parseDsn, reportCrashes, setObservability } from "@skiffr/observability"
import { RateLimiter } from "@skiffr/orpc"
import { createCvRuntime } from "@skiffr/orpc/cv"
import { advisoryLeader, createScheduler, LOCKS } from "@skiffr/orpc/gmail"
import { createWatchRuntime, createWatchScheduler } from "@skiffr/orpc/watch"
import { createStorage } from "@skiffr/storage"
import { ensureAdmin } from "./admin"
import { cookiePolicy } from "./cookies"
import { createDownloads } from "./downloads"
import { gmailFromEnv } from "./gmail-runtime"
import { pruneRateLimits } from "./prune"
import { createServer } from "./server"
import { createUpdateCheck, VERSION } from "./version"

const WATCH_TICK_MS = 5 * 60_000

const env = loadApiEnv()
const observability = createObservability(configFromEnv(env, { service: "skiffr-api", environment: env.DEPLOY_ENV }))
setObservability(observability)
const sinks = [
  env.GLITCHTIP_DSN && parseDsn(env.GLITCHTIP_DSN) && "errors",
  env.OTEL_EXPORTER_OTLP_ENDPOINT && "otlp",
  env.UMAMI_URL && env.UMAMI_WEBSITE_ID && "umami",
].filter(Boolean)
console.info(
  `observability: ${sinks.length > 0 ? sinks.join(", ") : "off"}${env.AI_TRACE_CAPTURE_CONTENT === "true" ? " (model call content captured)" : ""}`,
)
// A crash is reported before the process exits with code 1, as it did without this.
reportCrashes(observability, { job: "api" })
const db = createDb(env.DATABASE_URL)
await runMigrations(db)

// the raw value: the schema default would hide a forgotten DASHBOARD_URL
const cookies = cookiePolicy({ nodeEnv: env.NODE_ENV, dashboardUrl: process.env.DASHBOARD_URL })
if (cookies.warning) console.warn(cookies.warning)

const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  dashboardUrl: env.DASHBOARD_URL,
  trustedOrigins: [env.WEB_URL, env.DASHBOARD_URL],
  github:
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined,
  secureCookies: cookies.secure,
})

await ensureAdmin(db, auth, env.ADMIN_EMAIL, env.ADMIN_PASSWORD)
if (env.SEED === "preview") {
  const { runPreviewSeed } = await import("./seed/run")
  const { seeded, skipped } = await runPreviewSeed(db, auth, env)
  console.info(seeded ? "seeded preview data" : "preview data already seeded")
  for (const note of skipped) console.info(`preview seed skipped: ${note}`)
}

const extensionOrigins = env.EXTENSION_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
if (env.NODE_ENV === "production" && !extensionOrigins?.length) {
  console.warn("EXTENSION_ORIGINS is not set: any chrome-extension:// origin may call /rpc and /v1 with a token")
}

const gmail = gmailFromEnv(env)
const watch = createWatchRuntime({ refreshMinutes: env.WATCH_REFRESH_MINUTES })
const cv = env.CV_ENCRYPTION_KEY ? createCvRuntime({ encryptionKey: env.CV_ENCRYPTION_KEY }) : null

const latestRelease = createUpdateCheck({ repo: env.GITHUB_REPO ?? "FindMalek/skiffr" })

const embeddingModel =
  resolveEmbeddingModel(env) ??
  (env.SEED === "preview" ? (await import("./seed/embedding")).fakeEmbeddingModel() : null)

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
    // Previews have no provider key: a deterministic stand-in keeps similar-question suggestions clickable.
    embeddingModel,
    gmail,
    watch,
    cv,
    limits: new RateLimiter(),
    aiBudget: {
      dailyCalls: env.AI_DAILY_CALLS,
      dailyTokens: env.AI_DAILY_TOKENS,
      globalDailyCalls: env.AI_GLOBAL_DAILY_CALLS,
    },
  },
  {
    publicUrl: env.API_PUBLIC_URL,
    downloads: createDownloads({
      dir: env.DOWNLOADS_DIR ?? "downloads",
      version: VERSION,
      publicUrl: env.API_PUBLIC_URL,
      repo: env.GITHUB_REPO ?? "FindMalek/skiffr",
    }),
    version: async () => ({
      version: VERSION,
      commit: env.SKIFFR_COMMIT ?? null,
      updateCheck: env.UPDATE_CHECK === "true",
      ...(env.UPDATE_CHECK === "true" ? await latestRelease(VERSION) : {}),
    }),
    dashboardUrl: env.DASHBOARD_URL,
    extensionOrigins,
    clientIp: { header: env.CLIENT_IP_HEADER.toLowerCase(), trustedProxies: env.TRUSTED_PROXY_COUNT },
  },
)

const server = Bun.serve({
  port: env.PORT,
  hostname: "0.0.0.0",
  fetch: (request, bun) => fetch(request, bun.requestIP(request)?.address),
})
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

const PRUNE_MS = 60 * 60_000
const prune = () =>
  pruneRateLimits(db, new Date()).catch((error) => {
    console.error("[auth] could not prune rate limit rows")
    observability.captureError(error, { job: "prune" })
  })
await prune()
setInterval(prune, PRUNE_MS).unref()

let stopping = false
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    await scheduler?.stop()
    await watcher?.stop()
    await server.stop()
    await db.close()
    await observability.flush()
    process.exit(0)
  })
}
