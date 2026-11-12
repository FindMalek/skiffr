import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), "client")

const ENTRIES: Record<string, string> = {
  "react-form.js": join(CLIENT, "react-form.tsx"),
  "vue-form.js": join(CLIENT, "vue-form.ts"),
}

const cache = new Map<string, Promise<string>>()

function bundle(entry: string): Promise<string> {
  return build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    minify: true,
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      __VUE_OPTIONS_API__: "false",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
    logLevel: "silent",
  }).then((result) => result.outputFiles[0]?.text ?? "")
}

/** The framework pages ship a real React and a real Vue, bundled once on first use. */
export function clientBundle(name: string): Promise<string> | null {
  const entry = ENTRIES[name]
  if (!entry) return null
  let built = cache.get(name)
  if (!built) {
    built = bundle(entry)
    cache.set(name, built)
    built.catch(() => cache.delete(name))
  }
  return built
}

export const warmBundles = (): Promise<unknown> => Promise.all(Object.keys(ENTRIES).map((name) => clientBundle(name)))

export const staticScript = (name: string): Promise<string> => readFile(join(CLIENT, name), "utf8")
