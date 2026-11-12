import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { capture, launch } from "./capture.ts"
import { countFields, findViolations, looksLikeToken, SanitizeError, sanitizeHtml, scrubText } from "./sanitize.ts"
import { verifyOffline } from "./verify.ts"
import { TOOL_VERSION } from "./version.ts"

export const SNAPSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pages", "snapshots")
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const META_KEYS = ["capturedAt", "fields", "root", "source", "tool"]

const USAGE = `usage:
  pnpm snapshot <url...> [--click <selector>] [--root <selector>] [--slug <name>]
                         [--out <dir>] [--timeout <ms>] [--settle <ms>] [--delay <ms>] [--allow-local]
  pnpm snapshot --check [dir]

Opens a public page, takes the application form, sanitizes it and writes <out>/<slug>/index.html and meta.json.
Check the site's terms before committing a snapshot. The tool never fills or submits anything.`

const log = (message: string): void => console.log(message)

export function slugOf(url: URL): string {
  const host = url.hostname.replace(/^www\./, "")
  const segments = url.pathname
    .split("/")
    .filter((s) => /^[a-z][a-z0-9-]*$/i.test(s) && !looksLikeToken(s))
    .slice(0, 2)
  return [host, ...segments]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
}

export async function checkSnapshots(dir: string): Promise<string[]> {
  const problems: string[] = []
  let slugs: string[]
  try {
    slugs = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
  for (const slug of slugs) {
    const note = (message: string): number => problems.push(`${slug}: ${message}`)
    if (!SLUG.test(slug)) note("folder name is not a slug")
    const html = await readFile(join(dir, slug, "index.html"), "utf8").catch(() => null)
    if (html === null) note("index.html is missing")
    else for (const violation of findViolations(html)) note(violation)
    const raw = await readFile(join(dir, slug, "meta.json"), "utf8").catch(() => null)
    if (raw === null) {
      note("meta.json is missing")
      continue
    }
    try {
      const meta = JSON.parse(raw) as Record<string, unknown>
      if (Object.keys(meta).sort().join() !== META_KEYS.join()) note("meta.json has unexpected keys")
      if (typeof meta.source !== "string" || !/^[a-z0-9.-]+$/.test(meta.source))
        note("meta.json source is not a bare host")
    } catch {
      note("meta.json is not valid json")
    }
  }
  return problems
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
}

async function snapshotOne(
  url: string,
  options: Options,
  browser: Awaited<ReturnType<typeof launch>>,
): Promise<string> {
  const slug = options.slug ?? slugOf(new URL(url))
  if (!SLUG.test(slug)) throw new Error(`"${slug}" is not a valid slug: use lowercase letters, digits and dashes`)

  const captured = await capture(browser, { url, ...options })
  const html = sanitizeHtml(captured.html)
  const violations = findViolations(html)
  if (violations.length > 0) throw new Error(`the sanitized page still has: ${violations.join("; ")}`)
  const fields = countFields(html)
  if (JSON.stringify(fields) !== JSON.stringify(captured.fields)) {
    throw new Error(
      `the sanitizer changed the fields (page ${JSON.stringify(captured.fields)}, output ${JSON.stringify(fields)})`,
    )
  }
  const offline = await verifyOffline(browser, html)
  if (offline.length > 0) throw new Error(`the output is not self contained: ${offline.join("; ")}`)

  const meta = {
    capturedAt: new Date().toISOString().slice(0, 10),
    fields,
    root: scrubText(captured.selector).slice(0, 300),
    source: new URL(url).hostname.toLowerCase(),
    tool: `skiffr-snapshot ${TOOL_VERSION}`,
  }
  const folder = join(options.out, slug)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, "index.html"), html)
  await writeFile(join(folder, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`)
  log(`${slug}: ${Object.values(fields).reduce((a, b) => a + b, 0)} controls, root ${captured.rootBy} (${meta.root})`)
  return folder
}

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
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
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  if (values.help) {
    log(USAGE)
    return 0
  }
  if (values.check) {
    const dir = resolve(positionals[0] ?? SNAPSHOTS_DIR)
    if (!(await stat(dir).catch(() => null))) {
      log(`nothing to check: ${dir} does not exist`)
      return 0
    }
    const problems = await checkSnapshots(dir)
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
  }
  if (![options.timeoutMs, options.settleMs, options.delayMs].every((n) => Number.isFinite(n) && n >= 0)) {
    console.error("--timeout, --settle and --delay take a number of milliseconds")
    return 1
  }

  const browser = await launch()
  let failed = 0
  try {
    for (const [index, url] of positionals.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      try {
        await snapshotOne(url, options, browser)
      } catch (error) {
        failed++
        const message = error instanceof SanitizeError || error instanceof Error ? error.message : String(error)
        console.error(`${url.split(/[?#]/)[0]}: ${message}`)
      }
    }
  } finally {
    await browser.close()
  }
  log("Check the site's terms before committing a snapshot, and read the output once for anything personal.")
  return failed === 0 ? 0 : 1
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2))
}
