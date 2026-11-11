import { resolveEmbeddingModel, resolveModel } from "@skiffr/ai"
import { createAuth } from "@skiffr/auth"
import { createDb } from "@skiffr/db"
import { runMigrations } from "@skiffr/db/migrate"
import { seedDemo } from "@skiffr/db/seed"
import { loadApiEnv } from "@skiffr/env/api"
import { createStorage } from "@skiffr/storage"
import { ensureAdmin } from "./admin"
import { createServer } from "./server"

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
  },
  {
    publicUrl: env.API_PUBLIC_URL,
    extensionOrigins,
  },
)

const server = Bun.serve({ port: env.PORT, hostname: "0.0.0.0", fetch })
console.info(`api on :${server.port} (${env.DEPLOY_ENV})`)
