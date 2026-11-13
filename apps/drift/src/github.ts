import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { MARKER, outcomeOf } from "./report.ts"
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

const BOT_AUTHORS = ["github-actions", "app/github-actions", "github-actions[bot]"]

export const authorsFromEnv = (env: Record<string, string | undefined>): string[] => [
  ...BOT_AUTHORS,
  ...(env.DRIFT_ISSUE_AUTHORS ?? "")
    .split(",")
    .map((login) => login.trim())
    .filter(Boolean),
]

interface ListedIssue {
  number: number
  title: string
  body: string
  author?: { login?: string }
}

/** The one issue this tool wrote: exact title, our marker in the body and one of the allowed authors. Label alone proves nothing. */
export function ownIssue(listing: string, authors: string[]): string {
  let issues: ListedIssue[]
  try {
    const parsed: unknown = JSON.parse(listing)
    issues = Array.isArray(parsed) ? (parsed as ListedIssue[]) : []
  } catch {
    return ""
  }
  const mine = issues.find(
    (issue) =>
      issue.title === TITLE && (issue.body ?? "").includes(MARKER) && authors.includes(issue.author?.login ?? ""),
  )
  return mine ? String(mine.number) : ""
}

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
  /** Logins that may own the tracking issue. Anything else with the label is somebody else's issue and is left alone. */
  authors?: string[]
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
    "30",
    "--json",
    "number,title,body,author",
  ])
  if (found.code !== 0) throw new Error("could not list issues with gh")
  const number = ownIssue(found.stdout, input.authors ?? authorsFromEnv(process.env))
  const outcome = outcomeOf(input.report)
  // drift and runner errors keep the issue open, and a run that verified nothing never closes it
  if (outcome === "drift" || outcome === "errors" || (outcome === "unverified" && input.report.totals.error > 0)) {
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
  if (!number || outcome === "unverified") return "nothing"
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
