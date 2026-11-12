import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, test } from "node:test"
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

  test("sweep drops closed and idle previews and orphans, keeps live ones", async () => {
    await up({ pr: 1 })
    await up({ pr: 2 }, { fetch: async () => new Response(JSON.stringify({ ok: true, db: true, env: "pr-2" })) })
    mock.s.pulls.set(1, "open")
    mock.s.pulls.set(2, "open")
    // pr 9 only has leftovers: closed pull request, a bucket and a volume
    mock.s.pulls.set(9, "closed")
    mock.s.buckets.set("skiffr-pr-9", new Set(["a&b.png"]))
    mock.s.volumes.add("skiffr-db-pr-9-zzzzzz-data")
    // a volume of an old incarnation of pr 1's database
    mock.s.volumes.add("skiffr-db-pr-1-old000-data")
    const eightDays = Date.now() + 8 * 86_400_000
    assert.deepEqual(await previewSweep({ repo: "o/r", s3, env: { PREVIEW_TTL_DAYS: "7" }, now: Date.now() }), [9])
    assert.equal(mock.s.buckets.has("skiffr-pr-9"), false)
    // only the live databases keep their volume
    assert.equal(mock.s.volumes.size, 2)
    assert.equal(appsOf(1).length, 4)
    // a week and a day later both are idle
    assert.deepEqual(await previewSweep({ repo: "o/r", s3, env: { PREVIEW_TTL_DAYS: "7" }, now: eightDays }), [1, 2])
    assert.equal(mock.s.apps.size, 0)
    assert.equal(mock.s.pgs.size, 0)
    assert.equal(mock.s.volumes.size, 0)
    assert.equal(mock.s.buckets.size, 0)
    assert.match(mock.s.comments.find((c) => c.pr === 1).body, /idle days/)
  })
})
