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

test("the update check shares one lookup between concurrent callers and refuses a repo that is not owner/name", async () => {
  let calls = 0
  const check = createUpdateCheck({
    repo: "FindMalek/skiffr",
    fetch: (async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 20))
      return Response.json({ tag_name: "v0.3.0" })
    }) as unknown as typeof fetch,
  })
  const results = await Promise.all([check("0.2.0"), check("0.2.0"), check("0.2.0")])
  expect(calls).toBe(1)
  expect(results.every((r) => r.latest === "v0.3.0")).toBe(true)

  let asked = false
  const bad = createUpdateCheck({
    repo: "../../evil?x=1",
    fetch: (async () => {
      asked = true
      return Response.json({})
    }) as unknown as typeof fetch,
  })
  expect(await bad("0.2.0")).toEqual({ latest: null, updateAvailable: false })
  expect(asked).toBe(false)
})

const dir = mkdtempSync(join(tmpdir(), "skiffr-downloads-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("downloads serve the baked zip, a page that links it, and a clear 404 without one", async () => {
  const downloads = createDownloads({
    dir,
    version: "0.3.0",
    publicUrl: "http://localhost:3001",
    repo: "FindMalek/skiffr",
  })
  expect((await downloads("/downloads/skiffr-extension.zip"))?.status).toBe(404)
  expect(await downloads("/other")).toBeNull()

  const noZipPage = await (await downloads("/downloads"))?.text()
  expect(noZipPage).toContain('href="https://github.com/FindMalek/skiffr/releases/latest"')
  expect(noZipPage).not.toContain('href="/downloads/skiffr-extension.zip"')

  writeFileSync(join(dir, "skiffr-extension.zip"), "zip-bytes")
  const file = await downloads("/downloads/skiffr-extension.zip")
  expect(file?.headers.get("content-disposition")).toContain("skiffr-extension-v0.3.0.zip")
  expect(await file?.text()).toBe("zip-bytes")

  const page = await (await downloads("/downloads"))?.text()
  expect(page).toContain("http://localhost:3001")
  expect(page).toContain('href="/downloads/skiffr-extension.zip"')
  expect(page).not.toContain("releases/latest")
})
