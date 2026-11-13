export class SeedRefusedError extends Error {
  override name = "SeedRefusedError"
}

export interface SeedEnv {
  NODE_ENV?: string
  DEPLOY_ENV?: string
  SEED_ALLOW_PRODUCTION_BUILD?: string
}

const PREVIEW_ENV = /^pr-[1-9][0-9]*$/

/** True for a `pr-<n>` preview deploy, spelled exactly like that. */
export const isPreviewDeploy = (env: SeedEnv): boolean => PREVIEW_ENV.test(env.DEPLOY_ENV ?? "")

/**
 * The preview seed creates accounts with a password that is printed in a PR comment, so it only runs where nothing real
 * lives. It is an allowlist on the exact spelling of `DEPLOY_ENV`: `pr-<n>`, or `local` outside a production build.
 * Anything else (unset, `Production`, `prod`, `staging`, `pr-`, `PR-1`, a stray space) is refused, whatever `NODE_ENV` is.
 * A local production build (a docker run) needs `SEED_ALLOW_PRODUCTION_BUILD=yes`, which never works for another `DEPLOY_ENV`.
 */
export function assertPreviewSeedAllowed(env: SeedEnv): void {
  if (isPreviewDeploy(env)) return
  if (env.DEPLOY_ENV !== "local") {
    throw new SeedRefusedError(
      `SEED=preview only runs where DEPLOY_ENV is exactly "local" or "pr-<n>" (got ${JSON.stringify(env.DEPLOY_ENV ?? null)}): it creates accounts with a public password.`,
    )
  }
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return
  if (env.NODE_ENV === "production" && env.SEED_ALLOW_PRODUCTION_BUILD === "yes") return
  throw new SeedRefusedError(
    "SEED=preview is refused on a production build outside a pr-<n> preview. Set SEED_ALLOW_PRODUCTION_BUILD=yes if this is a throwaway environment.",
  )
}
