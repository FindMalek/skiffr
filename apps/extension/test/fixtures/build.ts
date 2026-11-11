import { cp, mkdir } from "node:fs/promises"
import { join } from "node:path"

const root = import.meta.dir
const out = join(root, "dist")
await mkdir(out, { recursive: true })

const result = await Bun.build({
  entrypoints: ["entry.ts", "react-app.tsx", "react-select-app.tsx", "vue-app.ts"].map((file) => join(root, file)),
  outdir: out,
  target: "browser",
  format: "iife",
  define: {
    "process.env.NODE_ENV": '"production"',
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
for (const page of [
  "static.html",
  "react.html",
  "react-select.html",
  "vue.html",
  "honeypots.html",
  "fill-lever.html",
  "fill-workable.html",
  "fill-ashby.html",
  "fill-edge.html",
])
  await cp(join(root, page), join(out, page))
console.log(`fixtures built in ${out}`)
