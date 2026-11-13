import { mkdtemp, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const HERE = dirname(fileURLToPath(import.meta.url))

// the runner imports workspace packages that node cannot load as they are, so it is bundled first, next to the packages it needs
const dir = await mkdtemp(join(HERE, ".build-"))
try {
  const outfile = join(dir, "main.mjs")
  await build({
    entryPoints: [join(HERE, "main.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["@playwright/test", "playwright-core", "esbuild"],
    logLevel: "silent",
  })
  const { run } = (await import(pathToFileURL(outfile).href)) as {
    run: (argv: string[], here: string) => Promise<number>
  }
  process.exitCode = await run(process.argv.slice(2), HERE)
} finally {
  await rm(dir, { recursive: true, force: true })
}
