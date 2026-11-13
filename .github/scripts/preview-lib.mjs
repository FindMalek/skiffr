import { APPS, imageFor } from "./deploy-lib.mjs"

export const MARKER = "skiffr-preview"
export const PROJECT = "skiffr-previews"
export const DEFAULT_MAX_PREVIEWS = 6
export const DEFAULT_TTL_DAYS = 7

export const STATUS = {
  building: "Building",
  ready: "Ready",
  failed: "Failed",
  removed: "Removed",
  skipped: "Not redeployed",
}
const ICON = { building: "🟡", ready: "✅", failed: "❌", removed: "⚪", skipped: "⚪" }

export const appResource = (pr, key) => `skiffr-${key}-pr-${pr}`
export const dbResource = (pr) => `skiffr-db-pr-${pr}`
export const bucketName = (pr) => `skiffr-pr-${pr}`
export const previewHost = (pr, key, domain) => `pr-${pr}-${key}.${String(domain).replace(/^\.+|\.+$/g, "")}`
export const previewTag = (pr, sha) => `pr-${pr}-${String(sha).slice(0, 7)}`

export function parseAppResource(name) {
  const m = /^skiffr-([a-z0-9]+(?:-[a-z0-9]+)*)-pr-([1-9]\d*)$/.exec(name ?? "")
  return m ? { key: m[1], pr: Number(m[2]) } : null
}
export const parseDbResource = (name) => {
  const m = /^skiffr-db-pr-([1-9]\d*)$/.exec(name ?? "")
  return m ? Number(m[1]) : null
}
/** Dokploy appends a random suffix to the postgres service name and mounts `<appName>-data`. */
export const parseDbVolume = (name) => {
  const m = /^skiffr-db-pr-([1-9]\d*)-[a-z0-9]+-data$/.exec(name ?? "")
  return m ? Number(m[1]) : null
}
export const parseBucket = (name) => {
  const m = /^skiffr-pr-([1-9]\d*)$/.exec(name ?? "")
  return m ? Number(m[1]) : null
}

export function dockerPort(dockerfile, fallback = 3000) {
  const m = /\bPORT=(\d+)/.exec(dockerfile ?? "")
  return m ? Number(m[1]) : fallback
}

/**
 * Every `apps/<name>/Dockerfile` is an app. The four production apps keep the port and health path of deploy-lib;
 * any other one (the e2e playground, once it has a Dockerfile) has no production image, so it is always built.
 */
export function discoverApps(found) {
  const known = new Map(APPS.map((a) => [a.key, a]))
  return found
    .map(({ app, dockerfile }) => {
      const prod = known.get(app)
      return {
        key: app,
        port: prod?.port ?? dockerPort(dockerfile),
        path: prod?.path ?? "/",
        production: Boolean(prod),
      }
    })
    .sort((a, b) => (a.key === "api" ? -1 : b.key === "api" ? 1 : a.key.localeCompare(b.key)))
}

/** The names `turbo ls --affected --output=json` reports. Turbo prints a banner line first on some versions. */
export function parseAffected(text) {
  const start = String(text).indexOf("{")
  if (start < 0) throw new Error("no json in the turbo output")
  return JSON.parse(String(text).slice(start)).packages.items.map((p) => p.name)
}

/** A changed app (or one that depends on a changed package) is built, every other one runs the production image. */
export function planApps({ apps, affected, buildAll = false }) {
  const build = []
  const reuse = []
  for (const app of apps) {
    ;(buildAll || !app.production || affected.includes(app.key) ? build : reuse).push(app.key)
  }
  return { build, reuse }
}

export const imageOf = (key, built, tag) => (built.includes(key) ? imageFor(key, tag) : imageFor(key, "main"))

export function parseEnvText(text) {
  return Object.fromEntries(
    (text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  )
}
export const envText = (vars) =>
  Object.entries(vars)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")

/** `preview` once the api accepts it (the seeder), `demo` until then, read from the source the images are built from. */
export function seedMode(envSource) {
  const list = /SEED:\s*z\.enum\(\[([^\]]*)\]/.exec(envSource ?? "")?.[1] ?? ""
  return list.includes('"preview"') ? "preview" : list.includes('"demo"') ? "demo" : "none"
}

/**
 * The whole env of a preview. Nothing here comes from production: the model, mail and Google keys are absent on purpose
 * (those features stay off), and the schedulers that call out to the internet are off.
 */
export function previewEnvs({ pr, apps, domain, apiInternalHost, databaseUrl, secrets, seed, s3, groqKey }) {
  const url = (key) => (apps.includes(key) ? `https://${previewHost(pr, key, domain)}` : undefined)
  const urls = {
    WEB_URL: url("web"),
    DASHBOARD_URL: url("dashboard"),
    API_PUBLIC_URL: url("api"),
    DOCS_URL: url("docs"),
    DEPLOY_ENV: `pr-${pr}`,
  }
  const front = { ...urls, API_URL: `http://${apiInternalHost}:3001` }
  const api = {
    ...urls,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    SEED: seed,
    BETTER_AUTH_SECRET: secrets.betterAuthSecret,
    ADMIN_EMAIL: secrets.adminEmail,
    ADMIN_PASSWORD: secrets.adminPassword,
    WATCH_SCHEDULER: "off",
    GMAIL_SCHEDULER: "off",
    ...(s3
      ? {
          S3_ENDPOINT: s3.endpoint,
          S3_REGION: s3.region,
          S3_BUCKET: s3.bucket,
          S3_ACCESS_KEY_ID: s3.accessKeyId,
          S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
        }
      : {}),
    ...(groqKey
      ? {
          AI_MODEL: "groq:openai/gpt-oss-20b",
          GROQ_API_KEY: groqKey,
          AI_DAILY_CALLS: "20",
          AI_GLOBAL_DAILY_CALLS: "200",
        }
      : {}),
  }
  return Object.fromEntries(apps.map((key) => [key, key === "api" ? api : front]))
}

export function tail(text, lines = 25, maxChars = 1800) {
  const out = String(text ?? "")
    .trimEnd()
    .split("\n")
    .slice(-lines)
    .join("\n")
  return out.length > maxChars ? `...${out.slice(-maxChars)}` : out
}

export const utc = (date) => `${new Date(date).toISOString().slice(0, 16).replace("T", " ")} UTC`

export function isExpired(deployedAt, now, ttlDays) {
  const t = Date.parse(deployedAt)
  return Number.isFinite(t) && now - t > ttlDays * 86_400_000
}

/**
 * rows: [{ key, source, status, url, error }], login: { url, email, password } once the preview is ready.
 * The password is for demo data only and the comment is public, nothing here is a real secret.
 */
export function renderComment({ pr, sha, rows, login, links, extension, note, updatedAt }) {
  const lines = [`<!-- ${MARKER} -->`, `### Preview for #${pr}`, ""]
  if (note) lines.push(note, "")
  lines.push("| App | Image | Status | Link |", "| --- | --- | --- | --- |")
  for (const r of rows) {
    const link = r.url && r.status !== "removed" ? `[${r.url.replace(/^https:\/\//, "")}](${r.url})` : "-"
    lines.push(`| **${r.key}** | ${r.source ?? "-"} | ${ICON[r.status]} ${STATUS[r.status]} | ${link} |`)
  }
  if (login) {
    lines.push(
      "",
      "**Test login** (seeded preview data, nothing real)",
      "",
      `- dashboard: ${login.url}`,
      `- email: \`${login.email}\``,
      `- password: \`${login.password}\``,
    )
  }
  if (links?.length) lines.push("", "**Useful links**", "", ...links.map(([label, href]) => `- [${label}](${href})`))
  if (extension) lines.push("", extension)
  for (const r of rows.filter((x) => x.status === "failed" && x.error)) {
    lines.push("", `<details><summary>${r.key} failed</summary>`, "", "```", tail(r.error), "```", "", "</details>")
  }
  if (sha) lines.push("", `Commit \`${String(sha).slice(0, 7)}\`${updatedAt ? `, updated ${utc(updatedAt)}` : ""}`)
  return lines.join("\n")
}

export function extensionNote({ pr, repo, runUrl, apiUrl, dashboardUrl }) {
  const artifact = runUrl
    ? `[\`extension-chrome-pr-${pr}\`](${runUrl}#artifacts)`
    : `\`extension-chrome-pr-${pr}\` from [the ci runs](https://github.com/${repo}/actions/workflows/ci.yml)`
  return [
    `**Extension**: take ${artifact} from the ci run, unzip it twice and load the folder unpacked (details in the docs).`,
    `In its options set the api url to \`${apiUrl}\`, then create a token in the dashboard under [Extension](${dashboardUrl}/extension) and paste it.`,
  ].join("\n")
}

export function pickLatest(deployments) {
  return [...(deployments ?? [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ?? null
}

// dokploy deployment status: running | done | error | cancelled
export function toStatus(deployment) {
  if (!deployment) return "building"
  if (deployment.status === "done") return "ready"
  if (deployment.status === "error" || deployment.status === "cancelled") return "failed"
  return "building"
}
