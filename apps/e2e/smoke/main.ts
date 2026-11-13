import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { type Baseline, baselineSchema } from "./drift.ts"
import { runSmoke } from "./runner.ts"
import { parseTargets } from "./schema.ts"
import { exitCodeOf, NOTHING_VERIFIED, renderSummary } from "./summary.ts"

const USAGE = `usage: pnpm --filter e2e smoke [--only <id,id>] [--update-baseline] [--targets <file>] [--out <dir>]
                                  [--traces] [--delay <ms>] [--timeout <ms>] [--settle <ms>] [--threshold <0-1>]

Opens the public pages in smoke/targets.json with the real extension and a mock api, fills them and never submits.
Writes summary.md and summary.json to --out (default smoke/results). --traces also keeps a trace of every failing target: it holds the page itself, so only use it on your own machine.
Exit code 1 when a target drifted or errored, 3 when no target ended ok or drift (nothing was verified), 2 for a setup problem, 0 otherwise.
Only public pages, at a low frequency: check each site's terms before adding a target.`

const number = (value: string | undefined, fallback: number): number => (value === undefined ? fallback : Number(value))

export async function run(argv: string[], here: string): Promise<number> {
  const baselines = join(here, "baselines")
  let values: ReturnType<typeof parseArgs>["values"]
  try {
    values = parseArgs({
      args: argv,
      options: {
        only: { type: "string" },
        "update-baseline": { type: "boolean", default: false },
        targets: { type: "string" },
        traces: { type: "boolean", default: false },
        out: { type: "string" },
        delay: { type: "string" },
        timeout: { type: "string" },
        settle: { type: "string" },
        threshold: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }).values
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const delayMs = number(values.delay as string | undefined, 10_000)
  const timeoutMs = number(values.timeout as string | undefined, 90_000)
  const settleMs = number(values.settle as string | undefined, 2_000)
  const driftThreshold = number(values.threshold as string | undefined, 0.25)
  if (
    ![delayMs, timeoutMs, settleMs].every((n) => Number.isFinite(n) && n >= 0) ||
    !(driftThreshold >= 0 && driftThreshold <= 1)
  ) {
    console.error(`--delay, --timeout and --settle take milliseconds, --threshold a fraction\n\n${USAGE}`)
    return 2
  }

  let targets = parseTargets(
    JSON.parse(await readFile(resolve((values.targets as string | undefined) ?? join(here, "targets.json")), "utf8")),
  )
  if (values.only) {
    const only = new Set((values.only as string).split(","))
    const unknown = [...only].filter((id) => !targets.some((target) => target.id === id))
    if (unknown.length > 0) {
      console.error(`unknown target: ${unknown.join(", ")}`)
      return 2
    }
    targets = targets.filter((target) => only.has(target.id))
  }

  const out = resolve((values.out as string | undefined) ?? join(here, "results"))
  const traceDir = values.traces === true ? join(out, "traces") : undefined
  await mkdir(traceDir ?? out, { recursive: true })
  const baselineFile = (id: string): string => join(baselines, `${id}.json`)
  const update = values["update-baseline"] === true

  let results: Awaited<ReturnType<typeof runSmoke>>
  try {
    results = await runSmoke({
      targets,
      extensionDir: resolve(
        process.env.E2E_EXTENSION_DIR ?? join(here, "..", "..", "extension", ".output", "chrome-mv3"),
      ),
      timeoutMs,
      settleMs,
      delayMs,
      driftThreshold,
      allowLocal: false,
      loadBaseline: async (id): Promise<Baseline | null> => {
        const text = await readFile(baselineFile(id), "utf8").catch(() => null)
        return text === null ? null : baselineSchema.parse(JSON.parse(text))
      },
      saveBaseline: update
        ? async (id, baseline) => {
            await mkdir(baselines, { recursive: true })
            await writeFile(baselineFile(id), `${JSON.stringify(baselineSchema.parse(baseline), null, 2)}\n`)
          }
        : undefined,
      traceDir,
      log: (line) => console.log(line),
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  const summary = renderSummary(results, new Date().toISOString().slice(0, 10))
  await writeFile(join(out, "summary.md"), summary)
  await writeFile(join(out, "summary.json"), `${JSON.stringify(results, null, 2)}\n`)
  console.log(`\n${summary}`)
  const code = exitCodeOf(results)
  if (code === 3) console.error(NOTHING_VERIFIED)
  return code
}
