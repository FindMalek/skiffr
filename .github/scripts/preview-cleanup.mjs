import { appendFileSync } from "node:fs"
import { deleteApplication, findStickyComment, github, setDeploymentStatus, upsertComment } from "./preview-api.mjs"
import { renderComment } from "./preview-lib.mjs"

const env = process.env
const summary = (text) => env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`)

const repo = env.GITHUB_REPOSITORY
const pr = Number(env.PR_NUMBER)

if (!env.DOKPLOY_URL || !env.DOKPLOY_TOKEN) {
  summary("### Preview cleanup skipped\n\n`DOKPLOY_URL` or `DOKPLOY_TOKEN` is unset.")
  process.exit(0)
}

const sticky = await findStickyComment(repo, pr)
const state = sticky?.state ?? {}
const rows = []

for (const [app, id] of Object.entries(state)) {
  let error
  try {
    await deleteApplication(id)
  } catch (e) {
    error = String(e.message ?? e)
    console.error(`could not delete ${app}: ${error}`)
  }
  rows.push({ app, status: error ? "failed" : "removed", error, updatedAt: new Date().toISOString() })
}

const deployments = await github("GET", `repos/${repo}/deployments?environment=preview-${pr}&per_page=100`)
for (const d of deployments) await setDeploymentStatus(repo, d.id, "inactive")

if (sticky) {
  const body = renderComment({
    pr,
    sha: env.HEAD_SHA ?? "",
    rows,
    state: rows.some((r) => r.status === "failed") ? state : {},
  })
  await upsertComment(repo, pr, body, sticky.id)
}
summary(`### Preview cleanup\n\n${rows.map((r) => `- ${r.app}: ${r.status}`).join("\n") || "nothing to remove"}`)
if (rows.some((r) => r.status === "failed")) process.exit(1)
