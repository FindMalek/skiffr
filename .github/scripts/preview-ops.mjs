import { randomBytes } from "node:crypto"
import { POSTGRES } from "./deploy-lib.mjs"
import {
  ciRunUrl,
  createGithubDeployment,
  deactivateDeployments,
  dokploy,
  findStickyComment,
  github,
  isDry,
  listDeployments,
  pruneImageTags,
  setDeploymentStatus,
  upsertComment,
} from "./preview-api.mjs"
import {
  appResource,
  bucketName,
  DEFAULT_MAX_PREVIEWS,
  DEFAULT_TTL_DAYS,
  dbResource,
  envText,
  extensionNote,
  imageOf,
  isExpired,
  PROJECT,
  parseAppResource,
  parseBucket,
  parseDbResource,
  parseDbVolume,
  parseEnvText,
  pickLatest,
  previewEnvs,
  previewHost,
  renderComment,
  toStatus,
} from "./preview-lib.mjs"

const log = (line) => console.info(line)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pollMs = () => Number(process.env.PREVIEW_POLL_MS ?? 5000)
const mask = (value) => process.env.GITHUB_ACTIONS && value && console.info(`::add-mask::${value}`)

export async function findEnvironment({ create = false } = {}) {
  const find = async () => (await dokploy("GET", "project.all", {})).find((p) => p.name === PROJECT)
  let project = await find()
  if (!project && create) {
    await dokploy("POST", "project.create", { name: PROJECT, description: "managed by .github/scripts/preview.mjs" })
    project = await find()
  }
  return project?.environments?.[0] ?? null
}

/** pr -> { apps: { key: applicationId }, pg: { postgresId, appName } | null }. project.all rows carry ids and app names only. */
export async function listResources(environment) {
  const byPr = new Map()
  const slot = (pr) => byPr.get(pr) ?? byPr.set(pr, { apps: {}, pg: null }).get(pr)
  for (const app of environment?.applications ?? []) {
    const parsed = parseAppResource(app.name)
    if (parsed) slot(parsed.pr).apps[parsed.key] = app.applicationId
  }
  for (const row of environment?.postgres ?? []) {
    const pg = await dokploy("GET", "postgres.one", { postgresId: row.postgresId })
    const pr = parseDbResource(pg.name)
    if (pr !== null) slot(pr).pg = { postgresId: row.postgresId, appName: pg.appName }
  }
  return byPr
}

async function apiEnvOf(slot) {
  if (!slot?.apps.api) return {}
  return parseEnvText((await dokploy("GET", "application.one", { applicationId: slot.apps.api })).env)
}

async function waitForDeployment(applicationId, known, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(pollMs())
    const latest = pickLatest((await listDeployments(applicationId)).filter((d) => !known.has(d.deploymentId)))
    if (latest && toStatus(latest) !== "building") {
      return toStatus(latest) === "ready"
        ? { ok: true }
        : { ok: false, error: latest.errorMessage ?? "deploy failed, open the Dokploy logs" }
    }
  }
  return { ok: false, error: "timed out waiting for the deploy" }
}

async function waitForPostgres(postgresId, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs
  let deployed = false
  while (Date.now() < deadline) {
    const pg = await dokploy("GET", "postgres.one", { postgresId })
    if (pg.applicationStatus === "done") return pg
    if (pg.applicationStatus === "error") throw new Error("the preview postgres failed to start")
    if (pg.applicationStatus === "idle" && !deployed) {
      deployed = true
      await dokploy("POST", "postgres.deploy", { postgresId })
    }
    await sleep(pollMs())
  }
  throw new Error("timed out waiting for the preview postgres")
}

async function ensurePostgres(environment, pr, slot) {
  let postgresId = slot?.pg?.postgresId
  if (!postgresId) {
    const name = dbResource(pr)
    const created = await dokploy("POST", "postgres.create", {
      name,
      appName: name,
      databaseName: POSTGRES.database,
      databaseUser: POSTGRES.user,
      databasePassword: randomBytes(18).toString("hex"),
      dockerImage: POSTGRES.image,
      environmentId: environment.environmentId,
    })
    postgresId = created?.postgresId ?? (await listResources(await findEnvironment())).get(pr)?.pg?.postgresId
    if (!postgresId) throw new Error("postgres.create returned no postgresId")
    await dokploy("POST", "postgres.deploy", { postgresId })
  }
  const pg = await waitForPostgres(postgresId)
  mask(pg.databasePassword)
  return pg
}

async function ensureApplication(environment, pr, key, slot) {
  if (slot?.apps[key]) return slot.apps[key]
  const name = appResource(pr, key)
  const created = await dokploy("POST", "application.create", {
    name,
    appName: name,
    environmentId: environment.environmentId,
  })
  if (created?.applicationId) return created.applicationId
  const fresh = (await findEnvironment())?.applications?.find((a) => a.name === name)
  if (!fresh) throw new Error(`application ${name} was not created`)
  return fresh.applicationId
}

async function ensureDomain(applicationId, host, port, resolver) {
  const domains = await dokploy("GET", "domain.byApplicationId", { applicationId })
  if (domains.some((d) => d.host === host)) return
  await dokploy("POST", "domain.create", {
    host,
    port,
    https: true,
    ...(resolver === "letsencrypt"
      ? { certificateType: "letsencrypt" }
      : { certificateType: "custom", customCertResolver: resolver }),
    applicationId,
    domainType: "application",
  })
}

async function smoke(fetchFn, { pr, apps, domain }) {
  const deadline = Date.now() + Number(process.env.PREVIEW_SMOKE_MS ?? 6 * 60_000)
  let pending = apps
  const healthy = async ({ key, path }) => {
    const res = await fetchFn(`https://${previewHost(pr, key, domain)}${path}`, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!res?.ok) return false
    if (key !== "api") return true
    const body = await res.json().catch(() => null)
    return body?.ok === true && body?.db === true && body?.env === `pr-${pr}`
  }
  while (pending.length > 0 && Date.now() < deadline) {
    const results = await Promise.all(pending.map(async (app) => [app, await healthy(app)]))
    pending = results.filter(([, ok]) => !ok).map(([app]) => app)
    if (pending.length > 0) await sleep(pollMs())
  }
  return pending.map((app) => app.key)
}

/**
 * Brings one PR's preview up: bucket, postgres, then the apps (api first, it migrates and seeds on start).
 * `build` lists the apps built for this commit, every other app runs the production image with the preview's env.
 */
export async function previewUp(o, deps = {}) {
  const { env, repo, pr, sha, apps, build, buildResult = "success", tag, domain, seed, s3 } = o
  const fetchFn = deps.fetch ?? fetch
  const keys = apps.map((a) => a.key)
  const url = (key) => `https://${previewHost(pr, key, domain)}`
  const rows = apps.map((a) => ({
    key: a.key,
    source: build.includes(a.key) ? `\`${tag}\`` : "`main` (production)",
    status: "building",
    url: url(a.key),
  }))
  let queue = Promise.resolve()
  const publish = (extra = {}) => {
    queue = queue.then(() => upsertComment(repo, pr, renderComment({ pr, sha, rows, updatedAt: new Date(), ...extra })))
    return queue
  }

  if (buildResult !== "success") {
    for (const row of rows) {
      row.status = build.includes(row.key) ? "failed" : "skipped"
      if (build.includes(row.key)) row.error = "the image build failed, see the preview workflow run"
    }
    await publish({ note: "Nothing was redeployed because an image did not build." })
    return { ok: false }
  }

  const resolver = env.PREVIEW_CERT_RESOLVER || "vercel"
  const maxPreviews = Number(env.PREVIEW_MAX || DEFAULT_MAX_PREVIEWS)
  const environment = await findEnvironment({ create: !isDry() })
  const resources = await listResources(environment)
  const slot = resources.get(pr)
  if (!slot && resources.size >= maxPreviews) {
    for (const row of rows) row.status = "skipped"
    await publish({
      note: `No preview: ${resources.size} previews already run (limit ${maxPreviews}). Close a pull request or wait for the idle sweep, then push again.`,
    })
    return { ok: true, skipped: true }
  }

  if (isDry()) {
    log(
      `[dry-run] preview ${pr}: build ${build.join(", ") || "nothing"}, reuse ${keys.filter((k) => !build.includes(k)).join(", ") || "nothing"}`,
    )
    log(
      `[dry-run] bucket ${s3 ? bucketName(pr) : "none"}, postgres ${dbResource(pr)}, hosts ${keys.map(url).join(" ")}`,
    )
    return { ok: true, dry: true }
  }

  const deploymentId = await createGithubDeployment(repo, sha, `preview-pr-${pr}`, `preview for #${pr}`)
  const status = (state, extra) => setDeploymentStatus(repo, deploymentId, state, { auto_inactive: false, ...extra })
  await status("in_progress", { log_url: env.RUN_URL })

  try {
    if (s3) await s3.client.createBucket(bucketName(pr))
    const pg = await ensurePostgres(environment, pr, slot)
    const ids = {}
    for (const { key } of apps) ids[key] = await ensureApplication(environment, pr, key, slot)
    const current = await apiEnvOf({ apps: { api: ids.api } })
    const secrets = {
      betterAuthSecret: current.BETTER_AUTH_SECRET || randomBytes(32).toString("base64"),
      adminEmail: current.ADMIN_EMAIL || `admin.pr${pr}@skiffr.test`,
      adminPassword: current.ADMIN_PASSWORD || randomBytes(12).toString("base64url"),
    }
    mask(secrets.betterAuthSecret)
    mask(s3?.config.secretAccessKey)
    const { appName: apiInternalHost } = await dokploy("GET", "application.one", { applicationId: ids.api })
    const envs = previewEnvs({
      pr,
      apps: keys,
      domain,
      apiInternalHost,
      databaseUrl: `postgresql://${encodeURIComponent(pg.databaseUser)}:${encodeURIComponent(pg.databasePassword)}@${pg.appName}:5432/${pg.databaseName}`,
      secrets,
      seed,
      s3: s3 && { ...s3.config, bucket: bucketName(pr) },
      groqKey: env.PREVIEW_GROQ_API_KEY,
    })
    envs.api = { ...envs.api, PREVIEW_DEPLOYED_AT: new Date().toISOString(), PREVIEW_POSTGRES_ID: pg.postgresId }
    await publish()

    const token = env.GHCR_READ_TOKEN
    const deploy = async ({ key, port }) => {
      const row = rows.find((r) => r.key === key)
      const applicationId = ids[key]
      await dokploy("POST", "application.saveDockerProvider", {
        applicationId,
        dockerImage: imageOf(key, build, tag),
        registryUrl: token ? "ghcr.io" : null,
        username: token ? env.GHCR_USERNAME : null,
        password: token || null,
      })
      await dokploy("POST", "application.saveEnvironment", {
        applicationId,
        env: envText(envs[key]),
        buildArgs: null,
        buildSecrets: null,
        createEnvFile: false,
      })
      await ensureDomain(applicationId, previewHost(pr, key, domain), port, resolver)
      const known = new Set((await listDeployments(applicationId)).map((d) => d.deploymentId))
      await dokploy("POST", "application.deploy", { applicationId, title: `PR #${pr} ${tag}` })
      const result = await waitForDeployment(applicationId, known, Number(env.PREVIEW_DEPLOY_MS ?? 12 * 60_000))
      row.status = result.ok ? "building" : "failed"
      if (!result.ok) row.error = result.error
      await publish()
      return result.ok
    }
    const first = await deploy(apps.find((a) => a.key === "api"))
    const rest = first ? await Promise.all(apps.filter((a) => a.key !== "api").map(deploy)) : []
    if (!first || rest.some((ok) => !ok)) throw new Error("a deploy failed")

    const unhealthy = await smoke(fetchFn, { pr, apps, domain })
    for (const row of rows) row.status = unhealthy.includes(row.key) ? "failed" : "ready"
    for (const key of unhealthy) rows.find((r) => r.key === key).error = "did not answer its health check in time"
    if (unhealthy.length > 0) throw new Error(`not healthy: ${unhealthy.join(", ")}`)

    const dashboard = url("dashboard")
    const runUrl = await ciRunUrl(repo, sha).catch(() => null)
    await publish({
      login: keys.includes("dashboard") && {
        url: `${dashboard}/sign-in`,
        email: secrets.adminEmail,
        password: secrets.adminPassword,
      },
      links: [
        ...(keys.includes("web") ? [["landing page", url("web")]] : []),
        ["api health", `${url("api")}/health`],
        ["api reference", `${url("api")}/v1/docs`],
        ...(keys.includes("docs") ? [["docs", `${url("docs")}/docs`]] : []),
      ],
      extension: extensionNote({ pr, repo, runUrl, apiUrl: url("api"), dashboardUrl: dashboard }),
    })
    await status("success", { environment_url: dashboard, log_url: env.RUN_URL })
    return { ok: true, rows }
  } catch (error) {
    for (const row of rows) if (row.status === "building") row.status = "failed"
    const failed = rows.find((r) => r.status === "failed" && !r.error)
    if (failed) failed.error = String(error.message ?? error)
    await publish({ note: `Preview failed: ${String(error.message ?? error).slice(0, 200)}` })
    await status("failure", { log_url: env.RUN_URL })
    return { ok: false, error }
  }
}

async function removeVolumes(names) {
  for (const name of names) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        await dokploy("POST", "dockerVolume.removeVolume", { volumeName: name })
        log(`removed volume ${name}`)
        break
      } catch (error) {
        // the volume is busy until the swarm has stopped the removed service's container
        if (attempt === 6) throw error
        await sleep(pollMs() * 2)
      }
    }
  }
}

/** Everything one PR owns: apps and their domains, postgres and its volume, the bucket, registry tags, github deployments. */
export async function removePreview(pr, { slot, volumes = [], s3, repo, note, appKeys = [] }) {
  const errors = []
  const step = async (label, fn) => {
    try {
      await fn()
      log(`removed ${label}`)
    } catch (error) {
      errors.push(`${label}: ${error.message}`)
      console.error(`could not remove ${label}: ${error.message}`)
    }
  }
  for (const [key, applicationId] of Object.entries(slot?.apps ?? {})) {
    await step(`app ${key}`, () => dokploy("POST", "application.delete", { applicationId }))
  }
  if (slot?.pg) await step("postgres", () => dokploy("POST", "postgres.remove", { postgresId: slot.pg.postgresId }))
  for (const volume of volumes.filter((v) => parseDbVolume(v) === pr)) {
    await step(`volume ${volume}`, () => removeVolumes([volume]))
  }
  if (s3) await step("bucket", () => s3.client.deleteBucket(bucketName(pr)))
  await step("registry tags", () => pruneImageTags(repo, pr, appKeys))
  await step("github deployments", () => deactivateDeployments(repo, pr))
  const rows = Object.keys(slot?.apps ?? {}).map((key) => ({ key, status: errors.length ? "failed" : "removed" }))
  if (rows.length && (await findStickyComment(repo, pr))) {
    await upsertComment(
      repo,
      pr,
      renderComment({ pr, sha: "", rows, note: errors.length ? `Cleanup hit errors: ${errors.join("; ")}` : note }),
    )
  }
  return errors
}

export async function listVolumes() {
  const volumes = await dokploy("GET", "dockerVolume.getVolumes", {})
  return (Array.isArray(volumes) ? volumes : []).map((v) => v.Name).filter((n) => parseDbVolume(n) !== null)
}

/** Only a closed pull request or a 404 counts as gone. Any other answer (500, 403, a network error) aborts the sweep. */
async function isClosed(repo, pr) {
  try {
    return (await github("GET", `repos/${repo}/pulls/${pr}`)).state === "closed"
  } catch (error) {
    if (error.status === 404) return true
    throw error
  }
}

/**
 * Closed or unknown pull requests and previews idle past the TTL, with their leftover volumes and buckets.
 * Every volume and bucket belongs to a pull request number, so there is no separate orphan pass: the volumes of an open
 * pull request are never touched, even when the previews project lookup came back empty.
 * Returns the removed pull requests and the errors that did not stop the sweep.
 */
export async function previewSweep({ repo, s3, env = process.env, now = Date.now(), appKeys = [] }) {
  const ttlDays = Number(env.PREVIEW_TTL_DAYS || DEFAULT_TTL_DAYS)
  const resources = await listResources(await findEnvironment())
  const volumes = await listVolumes()
  const buckets = s3 ? (await s3.client.listBuckets()).filter((b) => parseBucket(b) !== null) : []
  const prs = new Set([...resources.keys(), ...volumes.map(parseDbVolume), ...buckets.map(parseBucket)])
  const removed = []
  const errors = []
  for (const pr of [...prs].sort((a, b) => a - b)) {
    const closed = await isClosed(repo, pr)
    const slot = resources.get(pr)
    let note
    if (closed) note = "Removed, the pull request is closed."
    else if (slot && isExpired((await apiEnvOf(slot)).PREVIEW_DEPLOYED_AT, now, ttlDays)) {
      note = `Removed after ${ttlDays} idle days. Push a commit to bring it back.`
    }
    if (!note) continue
    log(`pr ${pr}: ${note}`)
    errors.push(...(await removePreview(pr, { slot, volumes, s3, repo, note, appKeys })))
    removed.push(pr)
  }
  return { removed, errors }
}

export async function previewDown({ pr, repo, s3, appKeys = [] }) {
  const environment = await findEnvironment()
  const slot = (await listResources(environment)).get(pr)
  return removePreview(pr, {
    slot,
    volumes: await listVolumes(),
    s3,
    repo,
    appKeys,
    note: "Removed, the pull request is closed.",
  })
}
