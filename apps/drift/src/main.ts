import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import type { Env } from "@skiffr/telemetry"
import { exportReport } from "./export.ts"
import { type GhRunner, updateTrackingIssue } from "./github.ts"
import { buildReport, outcomeOf, renderMarkdown } from "./report.ts"
import {
  type Baseline,
  baselineSchema,
  type DriftReport,
  reportSchema,
  type SmokeTarget,
  summarySchema,
  targetsSchema,
} from "./schema.ts"
import { type NodeRunner, takeSnapshots } from "./snapshots.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SNAPSHOT_CLI = resolve(HERE, "..", "..", "e2e", "tools", "snapshot", "cli.ts")

const USAGE = `usage: node src/cli.ts report --summary <summary.json> --baselines <dir> --out <dir>
                         [--targets <targets.json>] [--previous <drift-report.json>]
                         [--github] [--repo owner/name] [--export] [--snapshots]
                         [--snapshot-cli <path>] [--delay <ms>]
exit code: 0 clean, 1 drift or runner errors, 2 usage or input error, 3 nothing was verified`

export interface Deps {
  env?: Env
  fetch?: typeof fetch
  gh?: GhRunner
  node?: NodeRunner
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  log?: (line: string) => void
}

/** Bigger than any real summary: a file past this is refused before it is read into memory. */
const MAX_FILE_BYTES = 5_000_000

async function readJson(file: string): Promise<unknown> {
  if ((await stat(file)).size > MAX_FILE_BYTES) throw new Error("file too large")
  return JSON.parse(await readFile(file, "utf8"))
}

async function readBaselines(dir: string, ids: string[]): Promise<Map<string, Baseline>> {
  const found = new Map<string, Baseline>()
  for (const id of ids) {
    const parsed = baselineSchema.safeParse(await readJson(join(dir, `${id}.json`)).catch(() => null))
    if (parsed.success) found.set(id, parsed.data)
  }
  return found
}

export async function run(argv: string[], deps: Deps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line))
  let args: ReturnType<typeof parse>
  try {
    args = parse(argv)
  } catch {
    log(USAGE)
    return 2
  }
  const { values, positionals } = args
  if (positionals[0] !== "report" || !values.summary || !values.baselines || !values.out) {
    log(USAGE)
    return 2
  }
  const delayMs = Number(values.delay)
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    log("--delay must be a number of milliseconds")
    return 2
  }
  const out = resolve(values.out)
  let results: ReturnType<typeof summarySchema.parse>
  try {
    results = summarySchema.parse(await readJson(values.summary))
  } catch {
    log("the smoke summary could not be read: missing, over 5 MB, not json, or a field outside what the schema allows")
    return 2
  }
  const targets = new Map<string, SmokeTarget>()
  if (values.targets) {
    try {
      for (const target of targetsSchema.parse(await readJson(values.targets))) targets.set(target.id, target)
    } catch {
      log("the targets file could not be read, snapshots need it")
    }
  }
  let previous: DriftReport | null = null
  if (values.previous) {
    const parsed = reportSchema.safeParse(await readJson(values.previous).catch(() => null))
    if (parsed.success) previous = parsed.data
    else log("no usable previous report, every drift counts as new")
  }
  const baselines = await readBaselines(
    resolve(values.baselines),
    results.map((result) => result.id),
  )
  const report = buildReport({ results, baselines, targets, previous, now: (deps.now ?? (() => new Date()))() })
  const markdown = renderMarkdown(report)
  await mkdir(out, { recursive: true })
  await writeFile(join(out, "drift-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(join(out, "drift-report.md"), markdown)
  log(markdown.split("\n")[0] ?? "")

  if (values.snapshots) {
    const outcomes = await takeSnapshots({
      report,
      out,
      cli: resolve(values["snapshot-cli"] ?? DEFAULT_SNAPSHOT_CLI),
      delayMs,
      run: deps.node,
      sleep: deps.sleep,
    })
    for (const one of outcomes) log(`snapshot ${one.id}: ${one.note}`)
  }
  if (values.export) {
    const sent = await exportReport(report, deps.env ?? process.env, deps.fetch)
    for (const [name, result] of Object.entries(sent)) {
      log(`export ${name}: ${result.sent ? "sent" : "reason" in result ? result.reason : result.error}`)
    }
  }
  if (values.github) {
    try {
      const action = await updateTrackingIssue({
        report,
        bodyFile: join(out, "drift-report.md"),
        out,
        repo: values.repo,
        gh: deps.gh,
      })
      log(`tracking issue: ${action}`)
    } catch (error) {
      log(`tracking issue: ${error instanceof Error ? error.message : "failed"}`)
    }
  }
  // 3 means nothing was checked (smoke uses the same code): never read as clean
  const outcome = outcomeOf(report)
  return outcome === "drift" || outcome === "errors" ? 1 : outcome === "unverified" ? 3 : 0
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      summary: { type: "string" },
      baselines: { type: "string" },
      targets: { type: "string" },
      previous: { type: "string" },
      out: { type: "string" },
      repo: { type: "string" },
      github: { type: "boolean", default: false },
      export: { type: "boolean", default: false },
      snapshots: { type: "boolean", default: false },
      "snapshot-cli": { type: "string" },
      delay: { type: "string", default: "10000" },
    },
  })
}
