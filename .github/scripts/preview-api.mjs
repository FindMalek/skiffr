import { MARKER, parseStatePayload } from "./preview-lib.mjs"

const dokployUrl = () => String(process.env.DOKPLOY_URL).replace(/\/+$/, "")

async function call(url, init, label) {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

// Endpoint names and bodies below follow the Dokploy OpenAPI (docs.dokploy.com/docs/api), auth is the x-api-key header.
export function dokploy(method, path, body) {
  const headers = { "x-api-key": process.env.DOKPLOY_TOKEN, accept: "application/json" }
  let url = `${dokployUrl()}/api/${path}`
  const init = { method, headers }
  if (method === "GET") url += `?${new URLSearchParams(body)}`
  else {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  return call(url, init, `dokploy ${path}`)
}

export const createApplication = (name, environmentId) =>
  dokploy("POST", "application.create", { name, appName: name, environmentId })
export const saveGitProvider = (body) => dokploy("POST", "application.saveGitProvider", body)
export const saveBuildType = (body) => dokploy("POST", "application.saveBuildType", body)
export const saveEnvironment = (body) => dokploy("POST", "application.saveEnvironment", body)
export const createDomain = (body) => dokploy("POST", "domain.create", body)
export const deployApplication = (applicationId, title) =>
  dokploy("POST", "application.deploy", { applicationId, title })
export const deleteApplication = (applicationId) => dokploy("POST", "application.delete", { applicationId })
export const listDeployments = (applicationId) => dokploy("GET", "deployment.all", { applicationId })

// UNVERIFIED: the dashboard route shape. Falls back to the instance root if the project id is unknown.
export function inspectUrl(applicationId, application) {
  const env = application?.environment
  const projectId = env?.projectId ?? application?.projectId
  if (!projectId || !env?.environmentId) return dokployUrl()
  return `${dokployUrl()}/dashboard/project/${projectId}/environment/${env.environmentId}/services/application/${applicationId}?tab=deployments`
}

export const getApplication = (applicationId) => dokploy("GET", "application.one", { applicationId })

// UNVERIFIED: no documented endpoint to read build logs, so this uses the errorMessage Dokploy stores on a failed deployment.
export function failureExcerpt(deployment) {
  return deployment?.errorMessage ?? "build failed, open the Dokploy logs for details"
}

export function github(method, path, body) {
  const url = path.startsWith("http") ? path : `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/${path}`
  return call(
    url,
    {
      method,
      headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    `github ${method} ${path}`,
  )
}

export async function findStickyComment(repo, pr) {
  for (let page = 1; page < 10; page++) {
    const comments = await github("GET", `repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`)
    const hit = comments.find((c) => c.body?.includes(`<!-- ${MARKER} `))
    if (hit) return { id: hit.id, state: parseStatePayload(hit.body) ?? {} }
    if (comments.length < 100) break
  }
  return null
}

export async function upsertComment(repo, pr, body, existingId) {
  if (existingId) return github("PATCH", `repos/${repo}/issues/comments/${existingId}`, { body })
  return github("POST", `repos/${repo}/issues/${pr}/comments`, { body })
}

export async function createGithubDeployment(repo, ref, environment, description) {
  const d = await github("POST", `repos/${repo}/deployments`, {
    ref,
    environment,
    description,
    auto_merge: false,
    required_contexts: [],
    transient_environment: true,
    production_environment: false,
  })
  return d.id
}

export const setDeploymentStatus = (repo, id, state, extra = {}) =>
  github("POST", `repos/${repo}/deployments/${id}/statuses`, { state, ...extra })
