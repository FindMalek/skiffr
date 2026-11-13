#!/usr/bin/env node
// Decides the next release from git history: node scripts/release/plan.mjs [--sha HEAD] [--bump auto|patch|minor|major] [--repo owner/name] [--notes-out file]
// Prints JSON. In GitHub Actions it also writes release, version and tag to $GITHUB_OUTPUT. Changes nothing.
import { execFileSync } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { latestTag, parseLog, plan, renderNotes } from "./lib.mjs"

const { values } = parseArgs({
  options: {
    sha: { type: "string", default: "HEAD" },
    bump: { type: "string", default: "auto" },
    repo: { type: "string", default: process.env.GITHUB_REPOSITORY ?? "FindMalek/skiffr" },
    "notes-out": { type: "string" },
  },
})
if (!["auto", "patch", "minor", "major"].includes(values.bump)) {
  console.error(`--bump must be auto, patch, minor or major, got ${values.bump}`)
  process.exit(1)
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" })
const tags = git("tag", "--merged", values.sha, "--list", "v*.*.*").split("\n").filter(Boolean)
const lastTag = latestTag(tags)
const range = lastTag ? `${lastTag}..${values.sha}` : values.sha
const commits = parseLog(git("log", "--first-parent", "--format=%H%x1f%s%x1f%b%x1e", range))

const decision = plan({ lastTag, commits, forced: values.bump })
const result = { ...decision, tag: decision.release ? `v${decision.version}` : null, commits: commits.length }

if (decision.release && values["notes-out"]) {
  writeFileSync(
    values["notes-out"],
    renderNotes({ version: decision.version, previous: lastTag, commits, repo: values.repo }),
  )
}
if (process.env.GITHUB_OUTPUT) {
  const lines = [`release=${decision.release}`, `reason=${decision.reason ?? ""}`]
  if (decision.release) lines.push(`version=${decision.version}`, `tag=v${decision.version}`)
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`)
}
console.log(JSON.stringify(result, null, 2))
