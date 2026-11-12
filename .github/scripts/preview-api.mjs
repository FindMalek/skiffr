import { MARKER } from "./preview-lib.mjs"

const dokployUrl = () => String(process.env.DOKPLOY_URL).replace(/\/+$/, "")

/** --dry-run: reads go through, every write is logged and skipped. */
export const isDry = () => process.env.PREVIEW_DRY_RUN === "1"

async function call(url, init, label) {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

// Endpoint names and bodies follow the Dokploy OpenAPI (settings.getOpenApiDocument), auth is the x-api-key header.
export function dokploy(method, path, body) {
  if (method !== "GET" && isDry()) {
    console.info(`[dry-run] dokploy ${path}`)
    return Promise.resolve({})
  }
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

export const listDeployments = (applicationId) => dokploy("GET", "deployment.all", { applicationId })

export function github(method, path, body) {
  if (method !== "GET" && isDry()) {
    console.info(`[dry-run] github ${method} ${path}`)
    return Promise.resolve({})
  }
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
    const hit = comments.find((c) => c.body?.includes(`<!-- ${MARKER} -->`))
    if (hit) return hit.id
    if (comments.length < 100) break
  }
  return null
}

/** One comment per PR, edited in place. */
export async function upsertComment(repo, pr, body) {
  const id = await findStickyComment(repo, pr)
  if (id) return github("PATCH", `repos/${repo}/issues/comments/${id}`, { body })
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

export async function deactivateDeployments(repo, pr) {
  const deployments = await github("GET", `repos/${repo}/deployments?environment=preview-pr-${pr}&per_page=100`)
  for (const d of deployments) await setDeploymentStatus(repo, d.id, "inactive")
}

export async function ciRunUrl(repo, sha) {
  const { workflow_runs: runs = [] } = await github(
    "GET",
    `repos/${repo}/actions/runs?head_sha=${sha}&event=pull_request&per_page=30`,
  )
  const run = runs.find((r) => r.name === "ci")
  return run?.html_url ?? null
}

/** The pr-<n>-<sha> tags of a closed PR are deleted from ghcr, best effort: a failure only leaves registry clutter. */
export async function pruneImageTags(repo, pr, apps) {
  const owner = repo.split("/")[0]
  for (const app of apps) {
    const pkg = `skiffr-${app}`
    for (let page = 1; page < 20; page++) {
      const versions = await github(
        "GET",
        `users/${owner}/packages/container/${pkg}/versions?per_page=100&page=${page}`,
      ).catch(() => [])
      for (const v of versions) {
        const tags = v.metadata?.container?.tags ?? []
        if (tags.length > 0 && tags.every((t) => t.startsWith(`pr-${pr}-`))) {
          await github("DELETE", `users/${owner}/packages/container/${pkg}/versions/${v.id}`).catch((e) =>
            console.warn(`could not delete ${pkg} ${tags[0]}: ${e.message}`),
          )
        }
      }
      if (versions.length < 100) break
    }
  }
}
