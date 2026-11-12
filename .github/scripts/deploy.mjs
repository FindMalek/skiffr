import { APPS, appName, hostsFor, imageFor, PROJECT } from "./deploy-lib.mjs"
import { dokploy, listDeployments } from "./preview-api.mjs"
import { pickLatest, toStatus } from "./preview-lib.mjs"

const env = process.env
const POLL_MS = 5_000
const DEPLOY_TIMEOUT_MS = 12 * 60_000
const SMOKE_TIMEOUT_MS = 6 * 60_000

function need(name) {
  if (!env[name]) throw new Error(`${name} is not set`)
  return env[name]
}

const tag = need("IMAGE_TAG")
const hosts = hostsFor(need("PRODUCTION_DOMAIN"))
need("DOKPLOY_URL")
need("DOKPLOY_TOKEN")

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findApplications() {
  const projects = await dokploy("GET", "project.all", {})
  const project = projects.find((p) => p.name === PROJECT)
  const existing = (project?.environments ?? []).flatMap((e) => e.applications ?? [])
  return Object.fromEntries(
    APPS.map(({ key }) => {
      const app = existing.find((a) => a.name === appName(key))
      if (!app)
        throw new Error(
          `dokploy application ${appName(key)} not found, run scripts/dokploy-bootstrap.mjs --apply first`,
        )
      return [key, app.applicationId]
    }),
  )
}

async function waitForDeployment(applicationId, known) {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    const fresh = (await listDeployments(applicationId)).filter((d) => !known.has(d.deploymentId))
    const latest = pickLatest(fresh)
    if (latest && toStatus(latest) !== "building") return toStatus(latest) === "ready"
  }
  return false
}

/** Registry pulls from the home connection time out now and then, so a failed deploy gets one more try. */
async function deploy(key, applicationId) {
  const token = env.GHCR_READ_TOKEN
  await dokploy("POST", "application.saveDockerProvider", {
    applicationId,
    dockerImage: imageFor(key, tag),
    registryUrl: token ? "ghcr.io" : null,
    username: token ? need("GHCR_USERNAME") : null,
    password: token || null,
  })
  for (const attempt of [1, 2]) {
    const known = new Set((await listDeployments(applicationId)).map((d) => d.deploymentId))
    await dokploy("POST", "application.deploy", { applicationId, title: tag })
    if (await waitForDeployment(applicationId, known)) {
      console.info(`${appName(key)}: deployed ${imageFor(key, tag)}`)
      return
    }
    console.warn(`${appName(key)}: deploy failed (attempt ${attempt})`)
  }
  throw new Error(`${appName(key)} did not deploy`)
}

async function healthy({ key, path }) {
  const res = await fetch(`https://${hosts[key]}${path}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!res?.ok) return false
  if (key !== "api") return true
  const body = await res.json().catch(() => null)
  return body?.ok === true && body?.db === true
}

async function smoke() {
  const deadline = Date.now() + SMOKE_TIMEOUT_MS
  let pending = APPS
  while (pending.length > 0 && Date.now() < deadline) {
    const results = await Promise.all(pending.map(async (app) => [app, await healthy(app)]))
    pending = results.filter(([, ok]) => !ok).map(([app]) => app)
    if (pending.length > 0) await sleep(10_000)
  }
  for (const { key, path } of APPS) {
    console.info(`${pending.some((app) => app.key === key) ? "FAIL" : "ok  "} https://${hosts[key]}${path}`)
  }
  if (pending.length > 0) throw new Error(`not healthy: ${pending.map((app) => app.key).join(", ")}`)
}

const ids = await findApplications()
// The api goes first: it migrates the database on start and the frontends call it.
await deploy("api", ids.api)
await Promise.all(APPS.filter(({ key }) => key !== "api").map(({ key }) => deploy(key, ids[key])))
await smoke()
