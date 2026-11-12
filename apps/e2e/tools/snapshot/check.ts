import { lstat, readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { findViolations, sanitizeHtml } from "./sanitize.ts"

export const SNAPSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pages", "snapshots")

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILES = ["index.html", "meta.json"]
const META_KEYS = ["capturedAt", "fields", "root", "source", "tool"]
const ROOT_PATH =
  /^[a-z][a-z0-9-]*(?::nth-of-type\(\d{1,3}\))?(?: > [a-z][a-z0-9-]*(?::nth-of-type\(\d{1,3}\))?){0,60}$/
const FIELD_KIND = /^[a-z][a-z-]{0,24}$/

async function readText(path: string): Promise<string | null> {
  try {
    const bytes = await readFile(path)
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

function metaProblems(raw: string): string[] {
  const problems = findViolations(raw).map((violation) => `meta.json: ${violation}`)
  let meta: unknown
  try {
    meta = JSON.parse(raw)
  } catch {
    return [...problems, "meta.json is not valid json"]
  }
  if (typeof meta !== "object" || meta === null || Array.isArray(meta))
    return [...problems, "meta.json is not an object"]
  const record = meta as Record<string, unknown>
  if (Object.keys(record).sort().join() !== META_KEYS.join()) problems.push("meta.json has unexpected keys")
  const text = (key: string, pattern: RegExp, max: number): void => {
    const value = record[key]
    if (typeof value !== "string" || value.length > max || !pattern.test(value))
      problems.push(`meta.json ${key} has a bad shape`)
  }
  text("source", /^[a-z0-9.-]+$/, 253)
  text("capturedAt", /^\d{4}-\d{2}-\d{2}$/, 10)
  text("tool", /^skiffr-snapshot \d+\.\d+\.\d+$/, 40)
  text("root", ROOT_PATH, 600)
  const fields = record.fields
  const shaped =
    typeof fields === "object" &&
    fields !== null &&
    !Array.isArray(fields) &&
    Object.entries(fields).every(
      ([kind, count]) =>
        FIELD_KIND.test(kind) && Number.isInteger(count) && (count as number) >= 0 && (count as number) <= 100_000,
    )
  if (!shaped) problems.push("meta.json fields has a bad shape")
  return problems
}

function htmlProblems(html: string): string[] {
  const problems = findViolations(html)
  if (html.includes("\u0000") || html.startsWith("﻿")) problems.push("index.html has a NUL or a byte order mark")
  let again: string | null = null
  try {
    again = sanitizeHtml(html)
  } catch {
    problems.push("index.html cannot be sanitized")
  }
  if (again !== null && again !== html)
    problems.push("index.html is not the sanitizer's own output: take it again with pnpm snapshot")
  return problems
}

/** The problems of one snapshot folder, each prefixed with the slug. */
export async function checkSnapshotFolder(dir: string, slug: string): Promise<string[]> {
  const problems: string[] = []
  const note = (message: string): number => problems.push(`${slug}: ${message}`)
  const folder = join(dir, slug)
  const info = await lstat(folder)
  if (!info.isDirectory()) {
    note(info.isSymbolicLink() ? "is a symlink" : "is a loose file, snapshots live in folders")
    return problems
  }
  if (!SLUG.test(slug)) note("folder name is not a slug")
  for (const name of (await readdir(folder)).sort()) {
    if (!FILES.includes(name)) note(`unexpected entry ${name}`)
  }
  for (const name of FILES) {
    const path = join(folder, name)
    const file = await lstat(path).catch(() => null)
    if (!file) {
      note(`${name} is missing`)
      continue
    }
    if (!file.isFile()) {
      note(`${name} is not a regular file`)
      continue
    }
    const text = await readText(path)
    if (text === null) note(`${name} is not valid utf-8`)
    else for (const problem of name === "index.html" ? htmlProblems(text) : metaProblems(text)) note(problem)
  }
  return problems
}

/**
 * Every folder under `dir` must hold exactly a regular `index.html` and `meta.json`, nothing else and no symlink, both
 * read as strict utf-8, the page a fixed point of the sanitizer and free of what `findViolations` knows.
 */
export async function checkSnapshots(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    if (!(await lstat(dir)).isDirectory()) return [`${dir} is not a directory`]
    entries = (await readdir(dir)).sort()
  } catch {
    return [`${dir} cannot be read`]
  }
  const problems: string[] = []
  for (const slug of entries) problems.push(...(await checkSnapshotFolder(dir, slug)))
  return problems
}
