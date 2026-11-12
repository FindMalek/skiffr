import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { DriftReport } from "./schema.ts"

export interface RunResult {
  code: number
  output: string
}
export type NodeRunner = (args: string[]) => Promise<RunResult>

export const nodeRunner: NodeRunner = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, args, { maxBuffer: 4_000_000, timeout: 180_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0
      resolve({ code, output: `${stdout}${stderr}`.trim() })
    })
  })

const README = `these folders are sanitized snapshots of real pages that changed.
they are an artifact for a person or an agent to review and turn into a new adapter fixture
under apps/e2e/pages/adapters or apps/e2e/pages/snapshots. nothing here is committed for you.
each folder passed the snapshot tool's own --check (no personal data, no scripts, structure only).
`

export interface SnapshotOutcome {
  id: string
  ok: boolean
  note: string
}

/** Sequential and slow on purpose: one page at a time, a pause between pages, the tool's own guard and politeness rules apply. */
export async function takeSnapshots(input: {
  report: DriftReport
  out: string
  cli: string
  delayMs: number
  run?: NodeRunner
  sleep?: (ms: number) => Promise<void>
}): Promise<SnapshotOutcome[]> {
  const run = input.run ?? nodeRunner
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const dir = join(input.out, "snapshots")
  const wanted = input.report.targets.filter(
    (row) => row.url && (row.status === "drift" || (row.status === "ok" && row.signatureChanged)),
  )
  const outcomes: SnapshotOutcome[] = []
  if (wanted.length === 0) return outcomes
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "README.txt"), README)
  let first = true
  for (const row of wanted) {
    if (!first) await sleep(input.delayMs)
    first = false
    const args = [input.cli, row.url as string, "--out", dir, "--slug", row.id, "--force"]
    if (row.click) args.push("--click", row.click)
    const made = await run(args)
    outcomes.push({ id: row.id, ok: made.code === 0, note: made.code === 0 ? "snapshot taken" : lastLine(made.output) })
  }
  if (outcomes.some((one) => one.ok)) {
    const checked = await run([input.cli, "--check", dir])
    if (checked.code !== 0) {
      for (const one of outcomes)
        if (one.ok) Object.assign(one, { ok: false, note: `snapshot check failed: ${lastLine(checked.output)}` })
    }
  }
  return outcomes
}

const lastLine = (text: string): string => text.split("\n").filter(Boolean).pop()?.slice(0, 200) ?? "no output"
