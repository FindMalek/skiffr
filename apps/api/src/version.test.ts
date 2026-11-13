import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDownloads } from "./downloads"
import { createUpdateCheck, isNewer } from "./version"

test("isNewer compares releases numerically and ignores what it cannot read", () => {
  expect(isNewer("v0.10.0", "0.9.3")).toBe(true)
  expect(isNewer("v0.2.0", "0.2.0")).toBe(false)
  expect(isNewer("v0.1.9", "0.2.0")).toBe(false)
  expect(isNewer("nightly", "0.2.0")).toBe(false)
})

test("the update check asks GitHub once per window and survives a failure", async () => {
  let calls = 0
  let clock = 0
  let fail = false
  const check = createUpdateCheck({
    repo: "FindMalek/skiffr",
    now: () => clock,
    fetch: (async (url: string) => {
      calls++
      expect(url).toBe("https://api.github.com/repos/FindMalek/skiffr/releases/latest")
      if (fail) throw new Error("offline")
      return Response.json({ tag_name: "v0.3.0" })
    }) as unknown as typeof fetch,
  })
  expect(await check("0.2.0")).toEqual({ latest: "v0.3.0", updateAvailable: true })
  expect(await check("0.3.0")).toEqual({ latest: "v0.3.0", updateAvailable: false })
  expect(calls).toBe(1)

  clock = 7 * 60 * 60_000
  fail = true
  expect(await check("0.2.0")).toEqual({ latest: null, updateAvailable: false })
})

const dir = mkdtempSync(join(tmpdir(), "skiffr-downloads-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("downloads serve the baked zip, a page that links it, and a clear 404 without one", async () => {
  const downloads = createDownloads({ dir, version: "0.3.0", publicUrl: "http://localhost:3001" })
  expect((await downloads("/downloads/skiffr-extension.zip"))?.status).toBe(404)
  expect(await downloads("/other")).toBeNull()

  writeFileSync(join(dir, "skiffr-extension.zip"), "zip-bytes")
  const file = await downloads("/downloads/skiffr-extension.zip")
  expect(file?.headers.get("content-disposition")).toContain("skiffr-extension-v0.3.0.zip")
  expect(await file?.text()).toBe("zip-bytes")

  const page = await (await downloads("/downloads"))?.text()
  expect(page).toContain("http://localhost:3001")
  expect(page).toContain('href="/downloads/skiffr-extension.zip"')
})
