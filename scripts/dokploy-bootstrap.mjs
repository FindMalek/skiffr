#!/usr/bin/env node
// Creates the skiffr project on a Dokploy instance: pgvector postgres, api/web/dashboard/docs applications, domains and env.
// Dry run by default, --apply acts. Safe to rerun: existing things are kept and env keys already set are never overwritten.
// DOKPLOY_URL=https://dokploy.example.com DOKPLOY_TOKEN=... node scripts/dokploy-bootstrap.mjs --domain skiffr.example.com [--env-file .env.production] [--apply]
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { APPS, appName, hostsFor, imageFor, POSTGRES, PROJECT } from "../.github/scripts/deploy-lib.mjs"
import { dokploy } from "../.github/scripts/preview-api.mjs"
import { envForApp, OPTIONAL_KEYS } from "./bootstrap-env.mjs"

const { values: args } = parseArgs({
  options: {
    domain: { type: "string" },
    "env-file": { type: "string" },
    repo: { type: "string", default: "FindMalek/skiffr" },
    apply: { type: "boolean", default: false },
  },
})

if (!args.domain) {
  console.error(
    "usage: node scripts/dokploy-bootstrap.mjs --domain <base domain> [--env-file <path>] [--repo owner/name] [--apply]",
  )
  process.exit(1)
}

const apply = args.apply
const online = Boolean(process.env.DOKPLOY_URL && process.env.DOKPLOY_TOKEN)
if (apply && !online) {
  console.error("--apply needs DOKPLOY_URL and DOKPLOY_TOKEN in the environment")
  process.exit(1)
}
const hosts = hostsFor(args.domain)
const url = (key) => `https://${hosts[key]}`

// Only these keys are read from --env-file (see bootstrap-env.mjs), nothing from the shell environment. Values are never printed.
const GMAIL_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_ENCRYPTION_KEY"]

function parseEnvText(text, unquote = false) {
  return Object.fromEntries(
    (text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const value = line.slice(line.indexOf("=") + 1).trim()
        return [line.slice(0, line.indexOf("=")).trim(), unquote ? value.replace(/^(["'])(.*)\1$/, "$2") : value]
      }),
  )
}

const extras = Object.fromEntries(
  Object.entries(args["env-file"] ? parseEnvText(readFileSync(args["env-file"], "utf8"), true) : {}).filter(
    ([key, value]) => OPTIONAL_KEYS.includes(key) && value !== "",
  ),
)
const gmailSet = GMAIL_KEYS.filter((key) => extras[key])
if (gmailSet.length > 0 && gmailSet.length < GMAIL_KEYS.length) {
  console.error(`gmail import needs all of ${GMAIL_KEYS.join(", ")} or none`)
  process.exit(1)
}

const log = (line) => console.info(line)
const act = async (label, fn) => {
  log(`${apply ? "" : "[dry-run] would "}${label}`)
  return apply ? fn() : undefined
}
const secret = (bytes = 32) => randomBytes(bytes).toString("base64")

async function loadProject() {
  const projects = await dokploy("GET", "project.all", {})
  return projects.find((p) => p.name === PROJECT) ?? null
}

async function ensureProject() {
  if (!online) {
    log("[dry-run] no DOKPLOY_URL/DOKPLOY_TOKEN, planning from scratch")
    return null
  }
  let project = await loadProject()
  if (!project) {
    await act(`create project ${PROJECT}`, () =>
      dokploy("POST", "project.create", { name: PROJECT, description: "managed by scripts/dokploy-bootstrap.mjs" }),
    )
    if (apply) project = await loadProject()
  } else log(`project ${PROJECT} exists`)
  return project
}

const one = (path, params) => dokploy("GET", path, params)

// project.all can hide postgres services from an api key, so the id is also kept in the api app's env.
async function ensurePostgres(environment, apiEnv) {
  const knownId = apiEnv.DOKPLOY_POSTGRES_ID || environment?.postgres?.find((p) => p.name === POSTGRES.name)?.postgresId
  if (knownId) {
    const pg = await one("postgres.one", { postgresId: knownId })
    log(`postgres ${POSTGRES.name} exists (${pg.dockerImage})`)
    if (pg.dockerImage !== POSTGRES.image) {
      log(
        `warning: image is ${pg.dockerImage}, skiffr needs ${POSTGRES.image}. Do not swap it in place, see the Dokploy section of the docs`,
      )
    }
    return pg
  }
  const created = await act(`create postgres ${POSTGRES.name} on ${POSTGRES.image} and deploy it`, async () => {
    const result = await dokploy("POST", "postgres.create", {
      name: POSTGRES.name,
      appName: POSTGRES.name,
      databaseName: POSTGRES.database,
      databaseUser: POSTGRES.user,
      databasePassword: randomBytes(18).toString("hex"),
      dockerImage: POSTGRES.image,
      environmentId: environment.environmentId,
    })
    const postgresId =
      result?.postgresId ??
      (await loadProject()).environments[0].postgres.find((p) => p.name === POSTGRES.name)?.postgresId
    await dokploy("POST", "postgres.deploy", { postgresId })
    return one("postgres.one", { postgresId })
  })
  return created ?? null
}

async function ensureApplication(environment, key) {
  const name = appName(key)
  const existing = environment?.applications?.find((a) => a.name === name)
  if (existing) return one("application.one", { applicationId: existing.applicationId })
  const created = await act(`create application ${name}`, async () => {
    await dokploy("POST", "application.create", { name, appName: name, environmentId: environment.environmentId })
    const fresh = (await loadProject()).environments[0].applications.find((a) => a.name === name)
    return one("application.one", { applicationId: fresh.applicationId })
  })
  return created ?? null
}

function desiredEnv(key, { postgres, apiAppName, generated }) {
  const urls = {
    WEB_URL: url("web"),
    DASHBOARD_URL: url("dashboard"),
    API_PUBLIC_URL: url("api"),
    DOCS_URL: url("docs"),
    DEPLOY_ENV: "production",
    GITHUB_REPO: args.repo,
  }
  if (key !== "api")
    return { ...urls, API_URL: `http://${apiAppName ?? "<api app name>"}:3001`, ...envForApp(key, extras) }
  const database = postgres
    ? `postgresql://${postgres.databaseUser}:${postgres.databasePassword}@${postgres.appName}:5432/${postgres.databaseName}`
    : "(set once the postgres exists)"
  return {
    ...urls,
    NODE_ENV: "production",
    SEED: "none",
    DATABASE_URL: database,
    DOKPLOY_POSTGRES_ID: postgres?.postgresId ?? "(set once the postgres exists)",
    BETTER_AUTH_SECRET: generated.BETTER_AUTH_SECRET,
    ...(extras.ADMIN_EMAIL && !extras.ADMIN_PASSWORD ? { ADMIN_PASSWORD: generated.ADMIN_PASSWORD } : {}),
    ...envForApp("api", extras),
  }
}

/** Keys already set in Dokploy win, so generated secrets stay stable and manual edits survive a rerun. */
async function syncEnv(key, app, context) {
  const current = parseEnvText(app?.env)
  const wanted = desiredEnv(key, context)
  const missing = Object.keys(wanted).filter((k) => !(k in current))
  if (missing.length === 0) return log(`${appName(key)} env is complete`)
  await act(`set env keys on ${appName(key)}: ${missing.join(", ")}`, () =>
    dokploy("POST", "application.saveEnvironment", {
      applicationId: app.applicationId,
      env: Object.entries({ ...wanted, ...current })
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      buildArgs: null,
      buildSecrets: null,
      createEnvFile: false,
    }),
  )
}

async function ensureImage(key, app) {
  if (app?.dockerImage) return
  await act(`point ${appName(key)} at ${imageFor(key, "main")} (the first deploy workflow run replaces the tag)`, () =>
    dokploy("POST", "application.saveDockerProvider", {
      applicationId: app.applicationId,
      dockerImage: imageFor(key, "main"),
      registryUrl: null,
      username: null,
      password: null,
    }),
  )
}

async function ensureDomain(key, app, port) {
  const domains = app ? await one("domain.byApplicationId", { applicationId: app.applicationId }) : []
  if (domains.some((d) => d.host === hosts[key])) return log(`domain ${hosts[key]} exists`)
  await act(`add domain ${hosts[key]} -> ${appName(key)}:${port} (https, letsencrypt)`, () =>
    dokploy("POST", "domain.create", {
      host: hosts[key],
      port,
      https: true,
      certificateType: "letsencrypt",
      applicationId: app.applicationId,
      domainType: "application",
    }),
  )
}

log(
  `${apply ? "applying" : "dry run, nothing changes. Pass --apply to act"}: project ${PROJECT}, domain ${args.domain}`,
)
const project = await ensureProject()
const environment = project?.environments?.[0]

const apps = {}
for (const { key } of APPS) apps[key] = await ensureApplication(environment, key)
const apiEnv = parseEnvText(apps.api?.env)
const postgres = await ensurePostgres(environment, apiEnv)

const generated = { BETTER_AUTH_SECRET: secret(), ADMIN_PASSWORD: secret(18) }
const context = { postgres, apiAppName: apps.api?.appName, generated }
for (const { key, port } of APPS) {
  await ensureImage(key, apps[key])
  await syncEnv(key, apps[key], context)
  await ensureDomain(key, apps[key], port)
}

if (!extras.ADMIN_EMAIL) log("note: no ADMIN_EMAIL in the env file, the api starts without an admin account")
if (!extras.EXTENSION_ORIGINS)
  log("note: EXTENSION_ORIGINS is unset, any chrome extension origin may call the api with a token")
log(
  "secrets generated for a fresh install (BETTER_AUTH_SECRET, db password, ADMIN_PASSWORD) are stored in Dokploy only, read them there",
)
log("\ndns, one CNAME per host to the box (ttl 60):")
for (const { key } of APPS) log(`  ${hosts[key]}  CNAME  home.findmalek.engineer`)
log(
  `\ngithub: set repo variable PRODUCTION_DOMAIN=${args.domain}, DEPLOY_ENABLED=true and the DOKPLOY_URL variable and DOKPLOY_TOKEN secret`,
)
