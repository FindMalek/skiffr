import { writeFile } from "node:fs/promises"
import type { Auth } from "@skiffr/auth"
import type { Db } from "@skiffr/db"
import type { ApiEnv } from "@skiffr/env/api"
import { parseKey } from "@skiffr/orpc/gmail"
import { DEFAULT_DEMO_PASSWORD } from "./fixtures"
import { assertPreviewSeedAllowed, isPreviewDeploy } from "./guard"
import { type PreviewSeedResult, seedPreview } from "./preview"

export interface RunOptions {
  reset?: boolean
  /** Where to write the links json. Defaults to `SEED_LINKS_PATH`. */
  linksPath?: string
}

/** The one entry point of the preview seed, for the api start (`SEED=preview`) and the `seed:preview` command: the guard, the options from the env, the links file. */
export async function runPreviewSeed(
  db: Db,
  auth: Auth,
  env: ApiEnv,
  options: RunOptions = {},
): Promise<PreviewSeedResult> {
  assertPreviewSeedAllowed(env)
  const result = await seedPreview(db, auth, {
    password: env.SEED_DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD,
    dashboardUrl: env.DASHBOARD_URL,
    reset: options.reset || env.SEED_RESET === "on",
    refuseOtherUsers: !isPreviewDeploy(env),
    adminEmail: env.ADMIN_EMAIL,
    playgroundUrl: env.PLAYGROUND_URL,
    cvKey: env.CV_ENCRYPTION_KEY ? parseKey(env.CV_ENCRYPTION_KEY, "CV_ENCRYPTION_KEY") : undefined,
    cvUrl: env.SEED_CV_URL,
  })
  const path = options.linksPath ?? env.SEED_LINKS_PATH
  if (path) await writeFile(path, `${JSON.stringify(result.links, null, 2)}\n`)
  return result
}
