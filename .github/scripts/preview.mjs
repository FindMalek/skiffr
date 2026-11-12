#!/usr/bin/env node
// Per-PR preview environments on Dokploy, see apps/docs/content/docs/previews.mdx.
//   node .github/scripts/preview.mjs plan  [--affected <turbo json file>]   which apps to build, writes GITHUB_OUTPUT
//   node .github/scripts/preview.mjs up                                     bucket, postgres and apps of one PR
//   node .github/scripts/preview.mjs down                                   removes everything of one PR
//   node .github/scripts/preview.mjs sweep                                  closed, idle and orphaned previews
// --dry-run reads Dokploy and GitHub but changes nothing. Secrets are never printed.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { APPS } from "./deploy-lib.mjs"
import { upsertComment } from "./preview-api.mjs"
import {
  discoverApps,
  parseAffected,
  planApps,
  previewHost,
  previewTag,
  renderComment,
  seedMode,
} from "./preview-lib.mjs"
import { previewDown, previewSweep, previewUp } from "./preview-ops.mjs"
import { s3FromEnv } from "./preview-s3.mjs"

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: { affected: { type: "string" }, "dry-run": { type: "boolean", default: false } },
})
if (args["dry-run"]) process.env.PREVIEW_DRY_RUN = "1"

const env = process.env
const [command] = positionals
const output = (key, value) => env.GITHUB_OUTPUT && appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`)
const summary = (text) => env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`)

const REQUIRED = ["DOKPLOY_URL", "DOKPLOY_TOKEN", ...(command === "plan" || command === "up" ? ["PREVIEW_DOMAIN"] : [])]
const missing = REQUIRED.filter((key) => !env[key])
if (missing.length > 0) {
  summary(
    `### Preview skipped\n\nSet ${missing.map((k) => `\`${k}\``).join(", ")} (see the previews page of the docs).`,
  )
  console.info(`skipping, missing: ${missing.join(", ")}`)
  output("ready", "false")
  process.exit(0)
}
output("ready", "true")

const repo = env.GITHUB_REPOSITORY
if (["plan", "up", "down"].includes(command) && !/^[1-9][0-9]{0,8}$/.test(env.PR_NUMBER ?? "")) {
  console.error(
    `PR_NUMBER must be a positive integer of at most 9 digits, got ${JSON.stringify(env.PR_NUMBER ?? null)}`,
  )
  process.exit(1)
}
const pr = Number(env.PR_NUMBER)
const s3 = s3FromEnv(env)
const productionKeys = APPS.map((a) => a.key)

function discover() {
  const found = existsSync("apps")
    ? readdirSync("apps")
        .filter((app) => existsSync(`apps/${app}/Dockerfile`))
        .map((app) => ({ app, dockerfile: readFileSync(`apps/${app}/Dockerfile`, "utf8") }))
    : []
  return discoverApps(found)
}

function plan() {
  const apps = discover()
  let affected = []
  let buildAll = !args.affected || env.PREVIEW_BUILD_ALL === "true"
  if (args.affected) {
    try {
      affected = parseAffected(readFileSync(args.affected, "utf8"))
    } catch (error) {
      console.warn(`could not read the turbo output, building every app: ${error.message}`)
      buildAll = true
    }
  }
  const { build, reuse } = planApps({ apps, affected, buildAll })
  output("build", JSON.stringify(build))
  output("has_build", String(build.length > 0))
  output("tag", previewTag(pr, env.HEAD_SHA))
  summary(
    `### Preview plan\n\n- build: ${build.join(", ") || "nothing"}\n- production image: ${reuse.join(", ") || "nothing"}`,
  )
  console.info(`build: ${build.join(", ") || "nothing"}; production image: ${reuse.join(", ") || "nothing"}`)
  return { apps, build }
}

async function building({ apps, build }) {
  const rows = apps.map((a) => ({
    key: a.key,
    source: build.includes(a.key) ? "building" : "`main` (production)",
    status: "building",
    url: `https://${previewHost(pr, a.key, env.PREVIEW_DOMAIN)}`,
  }))
  await upsertComment(repo, pr, renderComment({ pr, sha: env.HEAD_SHA, rows, updatedAt: new Date() }))
}

if (command === "plan") {
  const planned = plan()
  if (!args["dry-run"]) await building(planned)
} else if (command === "up") {
  const apps = discover()
  const source = existsSync("packages/env/src/api.ts") ? readFileSync("packages/env/src/api.ts", "utf8") : ""
  const result = await previewUp({
    env,
    repo,
    pr,
    sha: env.HEAD_SHA,
    apps,
    build: JSON.parse(env.BUILD || "[]"),
    buildResult: env.BUILD_RESULT || "success",
    tag: previewTag(pr, env.HEAD_SHA),
    domain: env.PREVIEW_DOMAIN,
    seed: seedMode(source),
    s3,
  })
  if (!result.ok) process.exit(1)
} else if (command === "down") {
  const errors = await previewDown({ pr, repo, s3, appKeys: productionKeys })
  if (errors.length > 0) process.exit(1)
} else if (command === "sweep") {
  const { removed, errors } = await previewSweep({ repo, s3, appKeys: productionKeys })
  summary(
    `### Preview sweep\n\nremoved: ${removed.map((n) => `#${n}`).join(", ") || "nothing"}${errors.length ? `\n\nerrors:\n${errors.map((e) => `- ${e}`).join("\n")}` : ""}`,
  )
  if (errors.length > 0) process.exit(1)
} else {
  console.error("usage: preview.mjs <plan|up|down|sweep> [--dry-run] [--affected file]")
  process.exit(1)
}
