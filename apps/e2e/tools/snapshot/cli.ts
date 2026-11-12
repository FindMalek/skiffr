import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { capture, launch } from "./capture.ts"
import { checkSnapshotFolder, checkSnapshots, SNAPSHOTS_DIR } from "./check.ts"
import { countFields, findViolations, sanitizeHtml } from "./sanitize.ts"
import { verifyOffline } from "./verify.ts"
import { TOOL_VERSION } from "./version.ts"

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

const USAGE = `usage:
  pnpm snapshot <url...> [--click <selector>] [--root <selector>] [--slug <name>] [--force]
                         [--out <dir>] [--timeout <ms>] [--settle <ms>] [--delay <ms>] [--allow-local]
  pnpm snapshot --check [dir]

Opens a public page, takes the application form, sanitizes it and writes <out>/<slug>/index.html and meta.json.
The slug is the host name unless you pass --slug. An existing folder is only replaced with --force.
Check the site's terms before committing a snapshot. The tool never fills or submits anything.`

const log = (message: string): void => console.log(message)

export function slugOf(url: URL): string {
  return url.hostname
    .replace(/^www\./, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
}

interface Options {
  click?: string
  root?: string
  slug?: string
  out: string
  timeoutMs: number
  settleMs: number
  delayMs: number
  allowLocal: boolean
  force: boolean
}

function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Promise<void>): Promise<T> {
  const gaveUp = new Error(`gave up after ${Math.round(ms / 1000)}s: the page did not finish`)
  let timedOut = false
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      const closed = Promise.race([onTimeout(), new Promise((done) => setTimeout(done, 5_000))])
      void closed.finally(() => reject(gaveUp))
    }, ms)
  })
  const guarded = work.catch((error) => {
    throw timedOut ? gaveUp : error
  })
  return Promise.race([guarded, expired]).finally(() => clearTimeout(timer))
}

async function snapshotOne(url: string, options: Options): Promise<void> {
  const slug = options.slug ?? slugOf(new URL(url))
  if (!SLUG.test(slug)) throw new Error(`"${slug}" is not a valid slug: use lowercase letters, digits and dashes`)
  const folder = join(options.out, slug)
  const existing = await lstat(folder).catch(() => null)
  if (existing?.isSymbolicLink()) throw new Error(`${folder} is a symlink`)
  if (existing && !options.force)
    throw new Error(`${slug} already exists: pass --slug <name> for another folder or --force to replace it`)

  const browser = await launch()
  try {
    const deadline = options.timeoutMs * 3 + options.settleMs * 2 + 5_000
    const { html, selector, fields } = await withDeadline(
      (async () => {
        const captured = await capture(browser, { url, ...options })
        const clean = sanitizeHtml(captured.html)
        const violations = findViolations(clean)
        if (violations.length > 0) throw new Error(`the sanitized page still has: ${violations.join("; ")}`)
        const counted = countFields(clean)
        if (JSON.stringify(counted) !== JSON.stringify(captured.fields)) {
          throw new Error(
            `the sanitizer changed the fields (page ${JSON.stringify(captured.fields)}, output ${JSON.stringify(counted)})`,
          )
        }
        const offline = await verifyOffline(browser, clean)
        if (offline.length > 0) throw new Error(`the output is not self contained: ${offline.join("; ")}`)
        return { html: clean, selector: captured.selector, fields: counted }
      })(),
      deadline,
      () => browser.close().catch(() => undefined),
    )

    const meta = {
      capturedAt: new Date().toISOString().slice(0, 10),
      fields,
      root: selector,
      source: new URL(url).hostname.toLowerCase(),
      tool: `skiffr-snapshot ${TOOL_VERSION}`,
    }
    await mkdir(options.out, { recursive: true })
    const staging = await mkdtemp(join(dirname(options.out), ".skiffr-snapshot-"))
    try {
      await mkdir(join(staging, slug))
      await writeFile(join(staging, slug, "index.html"), html)
      await writeFile(join(staging, slug, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`)
      const problems = await checkSnapshotFolder(staging, slug)
      if (problems.length > 0) throw new Error(`the written snapshot failed its own check: ${problems.join("; ")}`)
      await rm(folder, { recursive: true, force: true })
      await rename(join(staging, slug), folder)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    log(`${slug}: ${Object.values(fields).reduce((a, b) => a + b, 0)} controls (${selector})`)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      click: { type: "string" },
      root: { type: "string" },
      slug: { type: "string" },
      out: { type: "string" },
      timeout: { type: "string", default: "30000" },
      settle: { type: "string", default: "1500" },
      delay: { type: "string", default: "2000" },
      "allow-local": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
}

export async function run(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 1
  }
  const { values, positionals } = parsed

  if (values.help) {
    log(USAGE)
    return 0
  }
  if (values.check) {
    const problems = await checkSnapshots(resolve(positionals[0] ?? SNAPSHOTS_DIR))
    for (const problem of problems) console.error(problem)
    log(problems.length === 0 ? "snapshots are clean" : `${problems.length} problem(s)`)
    return problems.length === 0 ? 0 : 1
  }
  if (positionals.length === 0) {
    console.error(USAGE)
    return 1
  }
  if (values.slug && positionals.length > 1) {
    console.error("--slug names one snapshot: pass one url")
    return 1
  }

  const options: Options = {
    click: values.click,
    root: values.root,
    slug: values.slug,
    out: resolve(values.out ?? SNAPSHOTS_DIR),
    timeoutMs: Number(values.timeout),
    settleMs: Number(values.settle),
    delayMs: Number(values.delay),
    allowLocal: values["allow-local"],
    force: values.force,
  }
  if (![options.timeoutMs, options.settleMs, options.delayMs].every((n) => Number.isFinite(n) && n >= 0)) {
    console.error("--timeout, --settle and --delay take a number of milliseconds")
    return 1
  }

  let failed = 0
  for (const [index, url] of positionals.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    try {
      await snapshotOne(url, options)
    } catch (error) {
      failed++
      console.error(`${url.split(/[?#]/)[0]}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  log("Check the site's terms before committing a snapshot, and read the output once for anything personal.")
  return failed === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2))
}
