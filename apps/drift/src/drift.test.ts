import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GhRunner } from "./github.ts"
import { run } from "./main.ts"
import { BODY_MAX, buildReport, escapeMd, MARKER, renderMarkdown, severityOf } from "./report.ts"
import { reportSchema, type SmokeResult, summarySchema } from "./schema.ts"
import type { NodeRunner } from "./snapshots.ts"

const seen = {
  toast: true,
  collected: 10,
  filled: 8,
  outlined: 0,
  left: 1,
  sensitiveAsked: 0,
  sensitiveFilled: 0,
  consoleErrors: 0,
  clickMissed: false,
}
const base = { ats: "lever", reasons: [], notes: [], ms: 1000, writesAborted: 0 }

const SUMMARY: SmokeResult[] = summarySchema.parse([
  { ...base, id: "lever-acme", status: "ok", observation: seen },
  {
    ...base,
    id: "ashby-acme",
    status: "drift",
    reasons: ["no fill offer was shown: detection stopped"],
    observation: { ...seen, toast: false, filled: 0, collected: 0 },
  },
  {
    ...base,
    id: "gh-acme",
    ats: "greenhouse",
    status: "drift",
    reasons: ["filled fell from 12 to 6"],
    observation: { ...seen, filled: 6 },
  },
  {
    ...base,
    id: "wk-acme",
    ats: "workable",
    status: "drift",
    reasons: ["1 sensitive field(s) were filled"],
    observation: { ...seen, sensitiveFilled: 1 },
  },
  { ...base, id: "sig-acme", status: "ok", notes: ["field signature changed"], observation: seen },
  { ...base, id: "dead", status: "gone", observation: null, extraKey: true },
])

async function workspace(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-test-"))
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(content))
  return dir
}

describe("severity", () => {
  test("ranks critical over high over medium, low only for a changed signature, gone never", () => {
    const by = (id: string) => SUMMARY.find((result) => result.id === id) as SmokeResult
    expect(severityOf(by("wk-acme"), false)).toBe("critical")
    expect(severityOf(by("ashby-acme"), false)).toBe("high")
    expect(severityOf(by("gh-acme"), false)).toBe("medium")
    expect(severityOf(by("sig-acme"), true)).toBe("low")
    expect(severityOf(by("lever-acme"), false)).toBe("none")
    expect(severityOf(by("dead"), false)).toBe("none")
  })
})

describe("report", () => {
  const baselines = new Map([
    ["gh-acme", { recorded: "2026-11-01", collected: 10, filled: 12, outlined: 0, signature: "0123456789abcdef" }],
  ])
  const now = new Date("2026-11-12T05:41:00Z")

  test("counts drift only for drift, computes deltas and diffs against the previous report", () => {
    const first = buildReport({ results: SUMMARY, baselines, targets: new Map(), previous: null, now })
    expect(first.totals).toMatchObject({
      drift: 3,
      gone: 1,
      changed: 4,
      bySeverity: { critical: 1, high: 1, medium: 1, low: 1 },
    })
    expect(first.targets.find((row) => row.id === "gh-acme")).toMatchObject({
      deltas: { filled: -6, collected: 0 },
      newSince: true,
    })
    expect(reportSchema.safeParse(first).success).toBe(true)

    const next = buildReport({
      results: SUMMARY.filter((result) => result.id !== "ashby-acme").map((result) =>
        result.id === "wk-acme" ? { ...result, status: "ok" as const, reasons: [], observation: seen } : result,
      ),
      baselines,
      targets: new Map(),
      previous: first,
      now,
    })
    expect(next.resolved.sort()).toEqual(["ashby-acme", "wk-acme"])
    expect(next.targets.find((row) => row.id === "gh-acme")).toMatchObject({ persisting: true, newSince: false })
  })

  test("the issue body is lowercase plain text without em dashes or tool names", () => {
    const report = buildReport({ results: SUMMARY, baselines, targets: new Map(), previous: null, now })
    const text = renderMarkdown({
      ...report,
      targets: report.targets.map((row) => ({ ...row, reasons: [...row.reasons, "a — b"] })),
    })
    expect(text).not.toMatch(/—|–/)
    expect(text).not.toMatch(/claude|openai|generated/i)
    expect(
      text.startsWith(
        "drift report 2026-11-12: critical: a sensitive field was touched on 1 real page. drift on 3 of 6",
      ),
    ).toBe(true)
  })
})

const OWN = JSON.stringify([
  {
    number: 42,
    title: "drift: real ats pages changed",
    body: `old\n${MARKER}\n`,
    author: { login: "github-actions" },
  },
])

describe("cli", () => {
  async function setup() {
    return workspace({
      "summary.json": SUMMARY,
      "gh-acme.json": { recorded: "2026-11-01", collected: 10, filled: 12, outlined: 0, signature: "0123456789abcdef" },
      "targets.json": [
        { id: "ashby-acme", url: "https://jobs.ashbyhq.com/acme/1", enabled: true },
        { id: "gh-acme", url: "https://job-boards.greenhouse.io/acme/jobs/1", click: "text=Apply", enabled: true },
        { id: "sig-acme", url: "https://jobs.lever.co/acme/1/apply", enabled: true },
      ],
    })
  }
  const args = (dir: string, more: string[] = []) => [
    "report",
    "--summary",
    join(dir, "summary.json"),
    "--baselines",
    dir,
    "--targets",
    join(dir, "targets.json"),
    "--out",
    join(dir, "out"),
    ...more,
  ]

  test("exit codes and written files", async () => {
    const dir = await setup()
    const logs: string[] = []
    expect(await run(args(dir), { log: (line) => logs.push(line) })).toBe(1)
    const report = JSON.parse(await readFile(join(dir, "out", "drift-report.json"), "utf8"))
    expect(report.schemaVersion).toBe(1)
    await writeFile(join(dir, "clean.json"), JSON.stringify(SUMMARY.slice(0, 1)))
    expect(
      await run(["report", "--summary", join(dir, "clean.json"), "--baselines", dir, "--out", join(dir, "o2")], {
        log: () => undefined,
      }),
    ).toBe(0)
    expect(await run(["report"], { log: () => undefined })).toBe(2)
  })

  test("github: creates, edits in place, closes when clean", async () => {
    const dir = await setup()
    const calls: string[][] = []
    const make =
      (open: string): GhRunner =>
      async (call) => {
        calls.push(call)
        return { code: 0, stdout: call[1] === "list" ? open : "" }
      }
    await run(args(dir, ["--github", "--repo", "o/r"]), { gh: make("[]"), log: () => undefined })
    expect(calls.map((call) => call.slice(0, 2).join(" "))).toEqual(["issue list", "label create", "issue create"])
    expect(calls[2]).toContain("drift")
    calls.length = 0
    await run(args(dir, ["--github"]), { gh: make(OWN), log: () => undefined })
    expect(calls.map((call) => call.slice(0, 3).join(" "))).toEqual(["issue list --label", "issue edit 42"])
    calls.length = 0
    await writeFile(join(dir, "clean.json"), JSON.stringify(SUMMARY.slice(0, 1)))
    await run(
      ["report", "--summary", join(dir, "clean.json"), "--baselines", dir, "--out", join(dir, "o3"), "--github"],
      { gh: make(OWN), log: () => undefined },
    )
    expect(calls.map((call) => call.slice(0, 3).join(" "))).toEqual([
      "issue list --label",
      "issue comment 42",
      "issue close 42",
    ])
  })

  test("snapshots: one at a time with a pause, click passed on, failure is a note, then --check", async () => {
    const dir = await setup()
    const calls: string[][] = []
    const pauses: number[] = []
    const node: NodeRunner = async (call) => {
      calls.push(call)
      return call.includes("ashby-acme") ? { code: 1, output: "gave up after 30s" } : { code: 0, output: "" }
    }
    const logs: string[] = []
    await run(args(dir, ["--snapshots", "--snapshot-cli", "/x/cli.ts", "--delay", "5"]), {
      node,
      sleep: async (ms) => void pauses.push(ms),
      log: (line) => logs.push(line),
    })
    expect(calls.map((call) => call[1])).toEqual([
      "https://jobs.ashbyhq.com/acme/1",
      "https://job-boards.greenhouse.io/acme/jobs/1",
      "https://jobs.lever.co/acme/1/apply",
      "--check",
    ])
    expect(calls[1]).toEqual(expect.arrayContaining(["--click", "text=Apply", "--slug", "gh-acme", "--force"]))
    expect(calls[0]?.[3]).toBe(join(dir, "out", "snapshots"))
    expect(pauses).toEqual([5, 5])
    expect(logs).toContain("snapshot ashby-acme: gave up after 30s")
    expect(await readFile(join(dir, "out", "snapshots", "README.txt"), "utf8")).toContain("nothing here is committed")
  })

  test("export reaches every configured service and skips the unset ones", async () => {
    const dir = await setup()
    const paths: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        paths.push(new URL(request.url).pathname)
        return new Response("{}")
      },
    })
    const logs: string[] = []
    try {
      const env = {
        OPENOBSERVE_URL: `http://127.0.0.1:${server.port}`,
        OPENOBSERVE_AUTH: "Basic eA==",
        GLITCHTIP_DSN: `http://k@127.0.0.1:${server.port}/3`,
      }
      await run(args(dir, ["--export"]), { env, log: (line) => logs.push(line) })
    } finally {
      server.stop(true)
    }
    expect(paths.sort()).toEqual(["/api/3/envelope/", "/api/default/skiffr_drift/_json", "/api/default/v1/metrics"])
    expect(logs).toContain("export umami: disabled")
    expect(logs.join("\n")).not.toContain("eA==")
  })
})

describe("a privacy regression is never quiet", () => {
  const sensitive = summarySchema.parse([
    { ...base, id: "lever-acme", status: "ok", observation: { ...seen, sensitiveFilled: 3 } },
  ])

  test("ok with a sensitive field filled counts as drift: exit 1, loud title, issue stays open", async () => {
    const dir = await workspace({ "summary.json": sensitive })
    const calls: string[][] = []
    const gh: GhRunner = async (call) => {
      calls.push(call)
      return { code: 0, stdout: call[1] === "list" ? OWN : "" }
    }
    const code = await run(
      ["report", "--summary", join(dir, "summary.json"), "--baselines", dir, "--out", join(dir, "out"), "--github"],
      { gh, log: () => undefined },
    )
    expect(code).toBe(1)
    expect(calls.map((call) => call.slice(0, 2).join(" "))).toEqual(["issue list", "issue edit"])
    const body = await readFile(join(dir, "out", "drift-report.md"), "utf8")
    expect(body).toMatch(/^drift report \S+: critical: a sensitive field was touched on 1 real page/)
  })

  test("an issue with the label but not our title, marker and author is never edited", async () => {
    const dir = await workspace({ "summary.json": sensitive })
    const foreign = JSON.stringify([
      { number: 7, title: "drift: real ats pages changed", body: "mine", author: { login: "someone" } },
      { number: 8, title: "other", body: MARKER, author: { login: "github-actions" } },
      { number: 9, title: "drift: real ats pages changed", body: MARKER, author: { login: "someone" } },
    ])
    const calls: string[][] = []
    const gh: GhRunner = async (call) => {
      calls.push(call)
      return { code: 0, stdout: call[1] === "list" ? foreign : "" }
    }
    await run(
      ["report", "--summary", join(dir, "summary.json"), "--baselines", dir, "--out", join(dir, "o"), "--github"],
      {
        gh,
        log: () => undefined,
      },
    )
    expect(calls.some((call) => call[1] === "edit")).toBe(false)
    expect(calls.at(-1)?.slice(0, 2)).toEqual(["issue", "create"])
  })
})

describe("hostile summary", () => {
  test("page derived text cannot mention, link, embed or break the table", () => {
    const text = escapeMd(
      "@FindMalek ![x](http://evil.example/p.png) <img src=x> [a](http://b.test) #12 www.evil.test\n# h1 | cell",
    )
    expect(text).not.toMatch(/@(?!\u200b)/)
    expect(text).not.toMatch(/(?<!\\)[[<]/)
    expect(text).not.toContain("://")
    expect(text).not.toContain("\n")
    expect(text).not.toMatch(/(?<!\\)\|/)
  })

  test("ids and board names that are not plain words are refused before anything is written", async () => {
    const bad = (extra: object) => [{ ...base, id: "lever-acme", status: "ok", observation: null, ...extra }]
    for (const extra of [{ id: "../../x" }, { ats: "gh|@FindMalek" }, { id: "a b" }]) {
      const dir = await workspace({ "summary.json": bad(extra) })
      const code = await run(
        ["report", "--summary", join(dir, "summary.json"), "--baselines", dir, "--out", join(dir, "o")],
        {
          log: () => undefined,
        },
      )
      expect(code).toBe(2)
    }
  })

  test("the body stays under what github accepts and says how many rows were cut", () => {
    const many = Array.from({ length: 400 }, (_, index) => ({
      ...base,
      id: `t${index}`,
      status: "drift" as const,
      reasons: Array.from({ length: 20 }, () => "x".repeat(500)),
      notes: [],
      observation: seen,
    }))
    const body = renderMarkdown(
      buildReport({
        results: many,
        baselines: new Map(),
        targets: new Map(),
        previous: null,
        now: new Date("2026-11-12T00:00:00Z"),
      }),
    )
    expect(body.length).toBeLessThan(BODY_MAX)
    expect(body).toMatch(/and \d+ more rows/)
  })

  test("a delay that is not a number is a usage error, not a removed pause", async () => {
    const dir = await workspace({ "summary.json": SUMMARY })
    const code = await run(
      [
        "report",
        "--summary",
        join(dir, "summary.json"),
        "--baselines",
        dir,
        "--out",
        join(dir, "o"),
        "--snapshots",
        "--delay",
        "x",
      ],
      { log: () => undefined },
    )
    expect(code).toBe(2)
  })
})
