import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { baselineSchema } from "./drift.ts"
import { parseTargets } from "./schema.ts"

const target = (over: Record<string, unknown> = {}) => ({
  id: "greenhouse-acme",
  ats: "greenhouse",
  url: "https://job-boards.greenhouse.io/acme/jobs/1",
  checked: "2026-11-12",
  expect: { minFilled: 3 },
  ...over,
})

describe("target schema", () => {
  test("the shipped targets are valid and public", () => {
    const file = JSON.parse(readFileSync(join(import.meta.dir, "targets.json"), "utf8"))
    expect(parseTargets(file).length).toBeGreaterThan(0)
  })

  test("every target has a baseline of counts and a hash, and no baseline is orphaned", () => {
    const ids = parseTargets(JSON.parse(readFileSync(join(import.meta.dir, "targets.json"), "utf8"))).map((t) => t.id)
    const dir = join(import.meta.dir, "baselines")
    const files = readdirSync(dir).map((name) => name.replace(/\.json$/, ""))
    expect(files.sort()).toEqual([...ids].sort())
    for (const id of ids)
      expect(baselineSchema.safeParse(JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"))).success).toBe(true)
  })

  test("fills in the defaults", () => {
    const [parsed] = parseTargets([target()])
    expect(parsed?.enabled).toBe(true)
    expect(parsed?.expect).toEqual({ minFilled: 3, detect: [], untouched: [], toast: true })
  })

  test.each([
    "http://127.0.0.1/jobs",
    "http://localhost:3000/jobs",
    "http://10.0.0.5/jobs",
    "http://192.168.1.1/jobs",
    "http://[::1]/jobs",
    "http://[::ffff:7f00:1]/jobs",
    "http://2130706433/jobs",
    "http://169.254.169.254/latest/meta-data",
    "http://careers.internal/jobs",
    "http://intranet/jobs",
  ])("rejects the private host %s", (url) => {
    expect(() => parseTargets([target({ url })])).toThrow()
  })

  test.each(["ftp://example.com/jobs", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "not a url"])(
    "rejects %s",
    (url) => {
      expect(() => parseTargets([target({ url })])).toThrow()
    },
  )

  test("a click selector that could submit is refused, an apply button is not", () => {
    for (const click of [
      "button[type=submit]",
      "text=Submit application",
      "#send",
      "text=Pay now",
      "xpath=//form//button",
      "//form/button",
    ]) {
      expect(() => parseTargets([target({ click })])).toThrow(/could submit/)
    }
    expect(parseTargets([target({ click: "text=Apply now" })])[0]?.click).toBe("text=Apply now")
  })

  test("the readPosts exception is gone", () => {
    expect(() => parseTargets([target({ readPosts: ["/api/x?op=Read"] })])).toThrow()
  })

  test("rejects credentials in the url", () => {
    expect(() => parseTargets([target({ url: "https://user:pass@jobs.lever.co/acme/1" })])).toThrow(/credentials/)
  })

  test("a local page is only allowed on request", () => {
    const local = target({ url: "http://127.0.0.1:4000/ats/greenhouse.html" })
    expect(() => parseTargets([local])).toThrow()
    expect(parseTargets([local], { allowLocal: true })).toHaveLength(1)
    expect(() => parseTargets([target({ url: "ftp://127.0.0.1/x" })], { allowLocal: true })).toThrow()
  })

  test("rejects duplicate ids, unknown keys, bad ids and unknown ats", () => {
    expect(() => parseTargets([target(), target()])).toThrow(/unique/)
    expect(() => parseTargets([target({ extra: 1 })])).toThrow()
    expect(() => parseTargets([target({ id: "Bad Id" })])).toThrow()
    expect(() => parseTargets([target({ ats: "taleo" })])).toThrow()
  })
})
