import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { DriftReport } from "./schema.ts"

export interface CommandResult {
  code: number
  stdout: string
}
export type GhRunner = (args: string[]) => Promise<CommandResult>

export const ghRunner: GhRunner = (args) =>
  new Promise((resolve) => {
    execFile("gh", args, { maxBuffer: 4_000_000 }, (error, stdout) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0
      resolve({ code, stdout: String(stdout) })
    })
  })

const TITLE = "drift: real ats pages changed"
const LABEL = "drift"

export type GithubAction = "created" | "updated" | "closed" | "nothing"

/**
 * One tracking issue with the label `drift`. Only issue list, create, edit, comment and close, plus the label itself.
 * `bodyFile` is the rendered report, `out` is where the clean comment is written.
 */
export async function updateTrackingIssue(input: {
  report: DriftReport
  bodyFile: string
  out: string
  repo?: string
  gh?: GhRunner
}): Promise<GithubAction> {
  const gh = input.gh ?? ghRunner
  const repo = input.repo ? ["-R", input.repo] : []
  const found = await gh([
    "issue",
    "list",
    ...repo,
    "--label",
    LABEL,
    "--state",
    "open",
    "--limit",
    "1",
    "--json",
    "number",
    "--jq",
    ".[0].number // empty",
  ])
  if (found.code !== 0) throw new Error("could not list issues with gh")
  const number = found.stdout.trim()
  if (input.report.drifted) {
    if (number) {
      await must(gh(["issue", "edit", number, ...repo, "--body-file", input.bodyFile]))
      return "updated"
    }
    await gh([
      "label",
      "create",
      LABEL,
      ...repo,
      "--color",
      "D93F0B",
      "--description",
      "real site drift found by the smoke run",
    ])
    await must(gh(["issue", "create", ...repo, "--title", TITLE, "--label", LABEL, "--body-file", input.bodyFile]))
    return "created"
  }
  if (!number) return "nothing"
  const comment = join(input.out, "drift-clean.md")
  await writeFile(comment, "the latest smoke run is clean again, closing.\n")
  await must(gh(["issue", "comment", number, ...repo, "--body-file", comment]))
  await must(gh(["issue", "close", number, ...repo]))
  return "closed"
}

async function must(run: Promise<CommandResult>): Promise<void> {
  const result = await run
  if (result.code !== 0) throw new Error("gh failed")
}
