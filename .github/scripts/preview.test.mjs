import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { afterEach, beforeEach, describe, test } from "node:test"
import { promisify } from "node:util"
import { findStickyComment } from "./preview-api.mjs"
import {
  discoverApps,
  parseAffected,
  parseAppResource,
  parseDbVolume,
  planApps,
  previewEnvs,
  seedMode,
} from "./preview-lib.mjs"
import { startMock } from "./preview-mock.mjs"
import { previewDown, previewSweep, previewUp } from "./preview-ops.mjs"
import { s3Client, signRequest } from "./preview-s3.mjs"

const APPS = discoverApps(["api", "web", "dashboard", "docs"].map((app) => ({ app, dockerfile: "ENV PORT=3000" })))

describe("pure helpers", () => {
  test("signs like the AWS documentation example", () => {
    const { authorization } = signRequest({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      headers: { Range: "bytes=0-9" },
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
    })
    assert.match(authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/)
  })

  test("a changed package rebuilds its dependents, the rest keeps the production image", () => {
    const affected = parseAffected(
      '• turbo 2.11.9\n{"packages":{"count":2,"items":[{"name":"@skiffr/ui"},{"name":"dashboard"}]}}',
    )
    assert.deepEqual(planApps({ apps: APPS, affected }), { build: ["dashboard"], reuse: ["api", "docs", "web"] })
    assert.deepEqual(planApps({ apps: APPS, affected: [], buildAll: true }).reuse, [])
  })

  test("an app without a production image is always built", () => {
    const apps = discoverApps([
      { app: "playground", dockerfile: "ENV PORT=4000" },
      ...["api"].map((app) => ({ app, dockerfile: "" })),
    ])
    assert.deepEqual(planApps({ apps, affected: [] }), { build: ["playground"], reuse: ["api"] })
    assert.equal(apps.find((a) => a.key === "playground").port, 4000)
  })

  test("seed mode follows what the api env accepts", () => {
    assert.equal(seedMode('SEED: z.enum(["none", "demo"]).default("demo"),'), "demo")
    assert.equal(seedMode('SEED: z.enum(["none", "demo", "preview"]).default("demo"),'), "preview")
  })

  test("resource names round trip and never match production", () => {
    assert.deepEqual(parseAppResource("skiffr-api-pr-12"), { key: "api", pr: 12 })
    assert.equal(parseAppResource("skiffr-api"), null)
    assert.equal(parseDbVolume("skiffr-db-pr-12-ab12cd-data"), 12)
    assert.equal(parseDbVolume("skiffr-db-data"), null)
    // leading zeros are another name, never pr 1
    assert.equal(parseAppResource("skiffr-api-pr-01"), null)
    assert.equal(parseDbVolume("skiffr-db-pr-01-ab12cd-data"), null)
  })

  test("an unsafe object key is never deleted", async () => {
    const mock = await startMock()
    try {
      const config = { endpoint: `${mock.origin}/s3`, region: "garage", accessKeyId: "key", secretAccessKey: "secret" }
      mock.s.buckets.set("skiffr-pr-1", new Set(["../skiffr-pr-2"]))
      mock.s.buckets.set("skiffr-pr-2", new Set())
      await assert.rejects(s3Client(config).deleteBucket("skiffr-pr-1"), /unsafe key/)
      assert.deepEqual(mock.s.writes, [])
    } finally {
      await mock.close()
    }
  })

  test("preview env carries no production secret and points at the preview", () => {
    const envs = previewEnvs({
      pr: 7,
      apps: ["api", "web", "dashboard", "docs"],
      domain: "preview.test",
      apiInternalHost: "skiffr-api-pr-7-abc",
      databaseUrl: "postgresql://u:p@db:5432/skiffr",
      secrets: { betterAuthSecret: "s".repeat(32), adminEmail: "a@b.test", adminPassword: "pw" },
      seed: "demo",
    })
    assert.equal(envs.api.DEPLOY_ENV, "pr-7")
    assert.equal(envs.api.WEB_URL, "https://pr-7-web.preview.test")
    assert.equal(envs.dashboard.API_URL, "http://skiffr-api-pr-7-abc:3001")
    for (const key of [
      "GROQ_API_KEY",
      "OPENAI_API_KEY",
      "GOOGLE_CLIENT_SECRET",
      "GMAIL_ENCRYPTION_KEY",
      "GITHUB_CLIENT_SECRET",
      "S3_ACCESS_KEY_ID",
    ]) {
      assert.equal(envs.api[key], undefined, key)
    }
    assert.equal(envs.api.WATCH_SCHEDULER, "off")
  })
})

describe("against the mock servers", () => {
  let mock
  const env = {}
  let s3

  beforeEach(async () => {
    mock = await startMock()
    Object.assign(process.env, {
      DOKPLOY_URL: mock.origin,
      DOKPLOY_TOKEN: "token",
      GITHUB_API_URL: `${mock.origin}/gh`,
      GITHUB_TOKEN: "gh",
      PREVIEW_POLL_MS: "1",
      PREVIEW_SMOKE_MS: "1000",
    })
    delete process.env.PREVIEW_DRY_RUN
    const config = { endpoint: `${mock.origin}/s3`, region: "garage", accessKeyId: "key", secretAccessKey: "secret" }
    s3 = { client: s3Client(config), config }
    Object.assign(env, { RUN_URL: "https://run", PREVIEW_MAX: "2" })
  })
  afterEach(() => mock.close())

  const up = (over = {}, deps = {}) =>
    previewUp(
      {
        env,
        repo: "o/r",
        pr: 5,
        sha: "abcdef1234",
        apps: APPS,
        build: ["dashboard"],
        tag: "pr-5-abcdef1",
        domain: "preview.test",
        seed: "demo",
        s3,
        ...over,
      },
      {
        fetch: async () =>
          new Response(JSON.stringify({ ok: true, db: true, env: "pr-5" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ...deps,
      },
    )
  const appsOf = (pr) => [...mock.s.apps.values()].filter((a) => a.name.endsWith(`-pr-${pr}`))

  test("brings every app up, builds only the changed one and wires the preview env", async () => {
    const result = await up()
    assert.equal(result.ok, true)
    assert.equal(appsOf(5).length, 4)
    const image = (key) => appsOf(5).find((a) => a.name === `skiffr-${key}-pr-5`).dockerImage
    assert.equal(image("dashboard"), "ghcr.io/findmalek/skiffr-dashboard:pr-5-abcdef1")
    assert.equal(image("api"), "ghcr.io/findmalek/skiffr-api:main")
    const api = appsOf(5).find((a) => a.name === "skiffr-api-pr-5")
    assert.match(api.env, /DATABASE_URL=postgresql:\/\/skiffr:[0-9a-f]+@skiffr-db-pr-5-y\d+:5432\/skiffr/)
    assert.match(api.env, /S3_BUCKET=skiffr-pr-5/)
    assert.match(api.env, /DEPLOY_ENV=pr-5/)
    const dashboard = appsOf(5).find((a) => a.name === "skiffr-dashboard-pr-5")
    assert.match(dashboard.env, new RegExp(`API_URL=http://${api.appName}:3001`))
    assert.deepEqual(mock.s.domains.get(dashboard.applicationId)[0], {
      host: "pr-5-dashboard.preview.test",
      port: 3002,
      https: true,
      certificateType: "custom",
      customCertResolver: "vercel",
      applicationId: dashboard.applicationId,
      domainType: "application",
    })
    assert.deepEqual([...mock.s.buckets.keys()], ["skiffr-pr-5"])
    assert.equal(mock.s.statuses.at(-1), "success")
    const [comment] = mock.s.comments
    assert.match(comment.body, /skiffr-preview/)
    assert.match(comment.body, /pr-5-dashboard\.preview\.test\/sign-in/)
    assert.match(comment.body, /admin\.pr5@skiffr\.test/)
    assert.match(comment.body, /runs\/9#artifacts/)
  })

  test("running again reuses everything and keeps the secrets", async () => {
    await up()
    const before = appsOf(5)
      .find((a) => a.name === "skiffr-api-pr-5")
      .env.match(/BETTER_AUTH_SECRET=(.*)/)[1]
    await up({ build: ["dashboard", "api"], tag: "pr-5-1234567" })
    assert.equal(appsOf(5).length, 4)
    assert.equal(mock.s.pgs.size, 1)
    assert.equal(mock.s.comments.length, 1)
    const api = appsOf(5).find((a) => a.name === "skiffr-api-pr-5")
    assert.equal(api.env.match(/BETTER_AUTH_SECRET=(.*)/)[1], before)
    assert.equal(api.dockerImage, "ghcr.io/findmalek/skiffr-api:pr-5-1234567")
  })

  test("refuses a new preview over the limit and says so", async () => {
    await up({ pr: 1 })
    await up({ pr: 2 }, { fetch: async () => new Response(JSON.stringify({ ok: true, db: true, env: "pr-2" })) })
    const result = await up({ pr: 3 })
    assert.equal(result.skipped, true)
    assert.equal(appsOf(3).length, 0)
    assert.match(mock.s.comments.find((c) => c.pr === 3).body, /limit 2/)
  })

  test("a failed image build is reported and nothing is deployed", async () => {
    const result = await up({ buildResult: "failure" })
    assert.equal(result.ok, false)
    assert.equal(mock.s.apps.size, 0)
    assert.match(mock.s.comments[0].body, /did not build/)
  })

  test("a preview that never turns healthy fails with its row marked", async () => {
    const result = await up({}, { fetch: async () => new Response("nope", { status: 502 }) })
    assert.equal(result.ok, false)
    assert.equal(mock.s.statuses.at(-1), "failure")
    assert.match(mock.s.comments[0].body, /did not answer its health check/)
  })

  test("dry run reads but never writes", async () => {
    process.env.PREVIEW_DRY_RUN = "1"
    const result = await up()
    assert.equal(result.dry, true)
    assert.deepEqual(mock.s.writes, [])
  })

  test("down removes apps, postgres, its volume, the bucket and the registry tags", async () => {
    await up()
    mock.s.pulls.set(5, "closed")
    mock.s.tags = [
      { id: 1, metadata: { container: { tags: ["pr-5-abcdef1"] } } },
      { id: 2, metadata: { container: { tags: ["main"] } } },
    ]
    const errors = await previewDown({ pr: 5, repo: "o/r", s3, appKeys: ["api"] })
    assert.deepEqual(errors, [])
    assert.equal(mock.s.apps.size, 0)
    assert.equal(mock.s.pgs.size, 0)
    assert.equal(mock.s.volumes.size, 0)
    assert.equal(mock.s.buckets.size, 0)
    assert.deepEqual(
      mock.s.tags.map((t) => t.id),
      [2],
    )
    assert.ok(mock.s.statuses.includes("inactive"))
    assert.match(mock.s.comments[0].body, /Removed/)
  })

  test("PR_NUMBER must be a positive integer of at most 9 digits", async () => {
    const run = (PR_NUMBER) =>
      promisify(execFile)(process.execPath, [new URL("./preview.mjs", import.meta.url).pathname, "down"], {
        env: {
          PATH: process.env.PATH,
          DOKPLOY_URL: mock.origin,
          DOKPLOY_TOKEN: "token",
          GITHUB_REPOSITORY: "o/r",
          GITHUB_API_URL: `${mock.origin}/gh`,
          GITHUB_TOKEN: "gh",
          PR_NUMBER,
        },
      }).then(
        () => ({ code: 0, stderr: "" }),
        (error) => ({ code: error.code, stderr: error.stderr }),
      )
    for (const bad of ["", "0", "012", "abc", "1;2", "1e1", "-1", " 12 ", "1234567890"]) {
      const result = await run(bad)
      assert.equal(result.code, 1, bad)
      assert.match(result.stderr, /PR_NUMBER must be/, bad)
    }
    assert.equal((await run("123456789")).stderr, "")
  })

  test("down keeps a registry version that also carries a production tag", async () => {
    await up()
    mock.s.tags = [
      { id: 1, metadata: { container: { tags: ["main", "pr-5-abcdef1"] } } },
      { id: 2, metadata: { container: { tags: ["pr-5-abcdef1"] } } },
    ]
    await previewDown({ pr: 5, repo: "o/r", s3, appKeys: ["api"] })
    assert.deepEqual(
      mock.s.tags.map((t) => t.id),
      [1],
    )
  })

  test("sweep drops closed and idle previews and orphans, keeps live ones", async () => {
    await up({ pr: 1 })
    await up({ pr: 2 }, { fetch: async () => new Response(JSON.stringify({ ok: true, db: true, env: "pr-2" })) })
    mock.s.pulls.set(1, "open")
    mock.s.pulls.set(2, "open")
    // pr 9 only has leftovers: closed pull request, a bucket and a volume
    mock.s.pulls.set(9, "closed")
    mock.s.buckets.set("skiffr-pr-9", new Set(["a&b.png"]))
    mock.s.volumes.add("skiffr-db-pr-9-zzzzzz-data")
    // a volume of an old incarnation of pr 1's database, kept while pr 1 is open
    mock.s.volumes.add("skiffr-db-pr-1-old000-data")
    const eightDays = Date.now() + 8 * 86_400_000
    const first = await previewSweep({ repo: "o/r", s3, env: { PREVIEW_TTL_DAYS: "7" }, now: Date.now() })
    assert.deepEqual(first, { removed: [9], errors: [] })
    assert.equal(mock.s.buckets.has("skiffr-pr-9"), false)
    // the volumes of open pull requests stay, the old one goes with the pull request
    assert.equal(mock.s.volumes.size, 3)
    assert.equal(appsOf(1).length, 4)
    // a week and a day later both are idle
    const second = await previewSweep({ repo: "o/r", s3, env: { PREVIEW_TTL_DAYS: "7" }, now: eightDays })
    assert.deepEqual(second.removed, [1, 2])
    assert.equal(mock.s.apps.size, 0)
    assert.equal(mock.s.pgs.size, 0)
    assert.equal(mock.s.volumes.size, 0)
    assert.equal(mock.s.buckets.size, 0)
    assert.match(mock.s.comments.find((c) => c.pr === 1).body, /idle days/)
  })

  test("sweep removes nothing when github fails, only a closed state or a 404 means closed", async () => {
    await up({ pr: 1 })
    await up({ pr: 2 }, { fetch: async () => new Response(JSON.stringify({ ok: true, db: true, env: "pr-2" })) })
    mock.s.pulls.set(1, "open")
    mock.s.pulls.set(2, "open")
    mock.s.writes.length = 0
    for (const status of [500, 403]) {
      mock.s.pullError = status
      await assert.rejects(previewSweep({ repo: "o/r", s3, now: Date.now() }), new RegExp(`\\(${status}\\)`))
      assert.deepEqual(mock.s.writes, [], `status ${status}`)
    }
    assert.equal(mock.s.apps.size, 8)
    // a pull request github does not know any more (404) is gone
    mock.s.pullError = null
    mock.s.pulls.delete(2)
    assert.deepEqual((await previewSweep({ repo: "o/r", s3, now: Date.now() })).removed, [2])
    assert.equal(appsOf(1).length, 4)
  })

  test("sweep never touches the volumes of open pull requests and one busy volume does not stop it", async () => {
    for (const [pr, state] of [
      [7, "open"],
      [9, "closed"],
      [10, "closed"],
    ])
      mock.s.pulls.set(pr, state)
    for (const v of ["skiffr-db-pr-7-aaaaaa-data", "skiffr-db-pr-9-bbbbbb-data", "skiffr-db-pr-10-cccccc-data"]) {
      mock.s.volumes.add(v)
    }
    mock.s.volumeError.add("skiffr-db-pr-9-bbbbbb-data")
    // the previews project lookup finds nothing, the open pull request must still keep its volume
    mock.s.noProject = true
    const result = await previewSweep({ repo: "o/r", s3, now: Date.now(), env: {} })
    assert.deepEqual(result.removed, [9, 10])
    assert.match(result.errors.join(), /skiffr-db-pr-9-bbbbbb-data/)
    assert.deepEqual([...mock.s.volumes].filter((v) => v !== "unrelated-data").sort(), [
      "skiffr-db-pr-7-aaaaaa-data",
      "skiffr-db-pr-9-bbbbbb-data",
    ])
  })

  test("down and sweep dry runs make no write call", async () => {
    await up({ pr: 1 })
    mock.s.pulls.set(1, "closed")
    mock.s.buckets.set("skiffr-pr-9", new Set())
    mock.s.volumes.add("skiffr-db-pr-9-zzzzzz-data")
    mock.s.pulls.set(9, "closed")
    mock.s.writes.length = 0
    process.env.PREVIEW_DRY_RUN = "1"
    await previewDown({ pr: 1, repo: "o/r", s3, appKeys: ["api"] })
    await previewSweep({ repo: "o/r", s3, now: Date.now() })
    assert.deepEqual(mock.s.writes, [])
    assert.equal(appsOf(1).length, 4)
  })

  test("production like names survive down and sweep", async () => {
    await up({ pr: 1 })
    const keep = [
      "skiffr-api",
      "skiffr-api-pr-1x",
      "skiffr-api-pr-1-extra",
      "xskiffr-api-pr-1",
      "skiffr-api-pr-01",
      "lodesong-pr-543",
    ]
    for (const name of keep) mock.s.apps.set(`keep-${name}`, { applicationId: `keep-${name}`, name, appName: name })
    mock.s.foreign.set("other-1", { applicationId: "other-1", name: "ceraghit-api-pr-1" })
    mock.s.foreign.set("prod-1", { applicationId: "prod-1", name: "skiffr-api" })
    for (const name of ["skiffr-db", "skiffr-db-pr-1-extra", "ceraghit-db-pr-1"]) {
      mock.s.pgs.set(`keep-${name}`, { postgresId: `keep-${name}`, name, appName: name })
    }
    const volumes = [
      "skiffr-db-abcdef-data",
      "skiffr-db-pr-1-data",
      "ceraghit-db-pr-1-abcdef-data",
      "skiffr-db-pr-01-abcdef-data",
    ]
    for (const v of volumes) mock.s.volumes.add(v)
    mock.s.buckets.set("skiffr-prod", new Set(["a"]))
    mock.s.buckets.set("skiffr-pr-1-x", new Set(["a"]))
    mock.s.buckets.set("skiffr-pr-12", new Set(["a"]))
    mock.s.pulls.set(1, "closed")
    mock.s.pulls.set(12, "open")
    await previewDown({ pr: 1, repo: "o/r", s3, appKeys: ["api"] })
    await previewSweep({ repo: "o/r", s3, now: Date.now() })
    assert.deepEqual([...mock.s.apps.keys()].sort(), keep.map((n) => `keep-${n}`).sort())
    assert.deepEqual([...mock.s.foreign.keys()].sort(), ["other-1", "prod-1"])
    assert.deepEqual([...mock.s.pgs.keys()].sort(), [
      "keep-ceraghit-db-pr-1",
      "keep-skiffr-db",
      "keep-skiffr-db-pr-1-extra",
    ])
    for (const v of volumes) assert.equal(mock.s.volumes.has(v), true, v)
    assert.deepEqual([...mock.s.buckets.keys()].sort(), ["skiffr-pr-1-x", "skiffr-pr-12", "skiffr-prod"])
  })

  test("the sticky comment is only trusted from the actions bot", async () => {
    process.env.GITHUB_REPOSITORY = "o/r"
    mock.s.comments.push({ id: 1, pr: 4, body: "<!-- skiffr-preview -->", user: { login: "someone" } })
    assert.equal(await findStickyComment("o/r", 4), null)
    mock.s.comments.push({ id: 2, pr: 4, body: "<!-- skiffr-preview -->", user: { login: "github-actions[bot]" } })
    assert.equal(await findStickyComment("o/r", 4), 2)
  })
})
