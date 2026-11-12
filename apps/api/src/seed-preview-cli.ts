import { createAuth } from "@skiffr/auth"
import { createDb } from "@skiffr/db"
import { runMigrations } from "@skiffr/db/migrate"
import { loadApiEnv } from "@skiffr/env/api"
import { seedLinksMarkdown } from "./seed/links"
import { runPreviewSeed } from "./seed/run"

/**
 * `bun src/seed-preview-cli.ts [--reset] [--out seed-links.json] [--markdown]`: seeds the preview dataset and prints the
 * links json (or the PR comment with --markdown) on stdout. Progress goes to stderr, so stdout stays machine readable.
 */
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined

const env = loadApiEnv()
const db = createDb(env.DATABASE_URL)
try {
  await runMigrations(db)
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    dashboardUrl: env.DASHBOARD_URL,
    trustedOrigins: [env.WEB_URL, env.DASHBOARD_URL],
    secureCookies: env.NODE_ENV === "production",
  })
  const { seeded, links, skipped } = await runPreviewSeed(db, auth, env, { reset: flag("--reset"), linksPath: out })
  console.error(
    seeded ? "seeded the preview data" : "preview data already there, nothing changed (use --reset to start over)",
  )
  for (const note of skipped) console.error(`skipped: ${note}`)
  console.info(flag("--markdown") ? seedLinksMarkdown(links) : JSON.stringify(links, null, 2))
} finally {
  await db.close()
}
