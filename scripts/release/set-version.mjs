#!/usr/bin/env node
// Writes the release version into the package.json of every app, so the extension manifest, the api and the images carry the tag.
// node scripts/release/set-version.mjs 1.2.3   (a leading v is accepted)
import { readFileSync, writeFileSync } from "node:fs"
import { setPackageVersion } from "./lib.mjs"

const version = (process.argv[2] ?? "").replace(/^v/, "")
const root = new URL("../../", import.meta.url)
const FILES = [
  "package.json",
  ...["api", "dashboard", "docs", "e2e", "extension", "web"].map((app) => `apps/${app}/package.json`),
]

try {
  for (const file of FILES) {
    const path = new URL(file, root)
    const text = readFileSync(path, "utf8")
    // the root package.json has no version field: it stays as it is
    if (file === "package.json" && !/^\s*"version":/m.test(text)) continue
    writeFileSync(path, setPackageVersion(text, version))
    console.log(`${file} -> ${version}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
