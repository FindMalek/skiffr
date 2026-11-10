import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs"
import {
  createApplication,
  createDomain,
  createGithubDeployment,
  deployApplication,
  failureExcerpt,
  findStickyComment,
  getApplication,
  inspectUrl,
  listDeployments,
  saveBuildType,
  saveEnvironment,
  saveGitProvider,
  setDeploymentStatus,
  upsertComment,
} from "./preview-api.mjs"
import { dockerPort, pickLatest, prAppName, previewHost, renderComment, toStatus } from "./preview-lib.mjs"

const env = process.env
const summary = (text) => env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`)

const missing = ["DOKPLOY_URL", "DOKPLOY_TOKEN", "PREVIEW_DOMAIN", "DOKPLOY_ENVIRONMENT_ID"].filter((k) => !env[k])
if (missing.length) {
  summary(
    `### Preview skipped\n\nSet ${missing.map((k) => `\`${k}\``).join(", ")} (repo variables, \`DOKPLOY_TOKEN\` as a secret) to enable PR previews.`,
  )
  console.log(`skipping, missing: ${missing.join(", ")}`)
  process.exit(0)
}

const repo = env.GITHUB_REPOSITORY
const pr = Number(env.PR_NUMBER)
const sha = env.HEAD_SHA
const ref = env.HEAD_REF
const timeoutMs = Number(env.PREVIEW_TIMEOUT_MIN ?? 25) * 60_000
const https = env.PREVIEW_HTTPS !== "false"

function discoverApps() {
  const apps = existsSync("apps")
    ? readdirSync("apps").map((a) => ({ app: a, dockerfile: `apps/${a}/Dockerfile` }))
    : []
  if (existsSync("docs/Dockerfile")) apps.push({ app: "docs", dockerfile: "docs/Dockerfile" })
  return apps.filter((a) => existsSync(a.dockerfile))
}

const apps = discoverApps()
const hostOf = (app) => previewHost(pr, app, env.PREVIEW_DOMAIN)
const urlOf = (app) => `${https ? "https" : "http"}://${hostOf(app)}`

const sticky = await findStickyComment(repo, pr)
const state = { ...(sticky?.state ?? {}) }
let commentId = sticky?.id
const now = () => new Date().toISOString()
const rows = apps.map(({ app }) => ({ app, status: "building", url: urlOf(app), updatedAt: now() }))

let queue = Promise.resolve()
function publish() {
  queue = queue.then(async () => {
    const res = await upsertComment(repo, pr, renderComment({ pr, sha, rows, state }), commentId)
    commentId = res.id
  })
  return queue
}

function appEnv() {
  const own = {
    WEB_URL: urlOf("web"),
    DASHBOARD_URL: urlOf("dashboard"),
    API_PUBLIC_URL: urlOf("api"),
  }
  const lines = Object.entries(own).map(([k, v]) => `${k}=${v}`)
  return [...lines, env.PREVIEW_APP_ENV ?? ""].filter(Boolean).join("\n")
}

function gitUrl() {
  const auth = env.PREVIEW_GIT_TOKEN ? `x-access-token:${env.PREVIEW_GIT_TOKEN}@` : ""
  return `https://${auth}github.com/${repo}.git`
}

async function ensureApplication({ app, dockerfile }) {
  if (state[app]) return state[app]
  const name = prAppName(pr, app)
  const created = await createApplication(name, env.DOKPLOY_ENVIRONMENT_ID)
  const id = created.applicationId
  if (!id) throw new Error("application.create returned no applicationId")
  state[app] = id
  await createDomain({
    host: hostOf(app),
    port: dockerPort(readFileSync(dockerfile, "utf8")),
    https,
    certificateType: https ? "letsencrypt" : "none",
    applicationId: id,
    domainType: "application",
  })
  return id
}

async function waitForDeployment(applicationId, known) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const d = pickLatest((await listDeployments(applicationId)).filter((x) => !known.has(x.deploymentId)))
    if (d && toStatus(d) !== "building") return d
    await new Promise((r) => setTimeout(r, 10_000))
  }
  return null
}

const pending = new Set()
process.on("SIGINT", async () => {
  await Promise.allSettled(
    [...pending].map((id) => setDeploymentStatus(repo, id, "failure", { description: "run cancelled" })),
  )
  process.exit(130)
})

async function runApp({ app, dockerfile }) {
  const row = rows.find((r) => r.app === app)
  const ghDeployment = await createGithubDeployment(repo, sha, `preview-${pr}`, `${app} preview for #${pr}`)
  pending.add(ghDeployment)
  const status = (st, extra) => setDeploymentStatus(repo, ghDeployment, st, { auto_inactive: false, ...extra })
  try {
    const id = await ensureApplication({ app, dockerfile })
    row.inspectUrl = inspectUrl(id, await getApplication(id).catch(() => null))
    await status("in_progress", { log_url: row.inspectUrl, environment_url: row.url })
    await publish()
    await saveGitProvider({
      applicationId: id,
      customGitUrl: gitUrl(),
      customGitBranch: ref,
      customGitBuildPath: "/",
      watchPaths: null,
    })
    await saveBuildType({
      applicationId: id,
      buildType: "dockerfile",
      dockerfile,
      dockerContextPath: ".",
      dockerBuildStage: null,
      herokuVersion: null,
      railpackVersion: null,
    })
    await saveEnvironment({
      applicationId: id,
      env: appEnv(),
      buildArgs: null,
      buildSecrets: null,
      createEnvFile: true,
    })
    const known = new Set((await listDeployments(id)).map((x) => x.deploymentId))
    await deployApplication(id, `PR #${pr} ${sha.slice(0, 7)}`)
    const done = await waitForDeployment(id, known)
    row.status = done ? toStatus(done) : "failed"
    if (row.status === "failed") row.error = done ? failureExcerpt(done) : "timed out waiting for the build"
  } catch (e) {
    row.status = "failed"
    row.error = String(e.message ?? e)
  }
  row.updatedAt = now()
  pending.delete(ghDeployment)
  await status(row.status === "ready" ? "success" : "failure", {
    log_url: row.inspectUrl ?? env.RUN_URL,
    environment_url: row.url,
  })
  await publish()
}

await publish()
await Promise.all(apps.map(runApp))

summary(`### Preview deployments\n\n${rows.map((r) => `- ${r.app}: ${r.status} ${r.url}`).join("\n")}`)
if (rows.some((r) => r.status === "failed")) process.exit(1)
