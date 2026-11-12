export class SeedRefusedError extends Error {
  override name = "SeedRefusedError"
}

export interface SeedEnv {
  NODE_ENV: string
  DEPLOY_ENV: string
  SEED_ALLOW_PRODUCTION_BUILD?: string
}

const PREVIEW_ENV = /^pr-\d+$/

/**
 * The preview seed creates accounts with a password that is printed in a PR comment, so it only runs where nothing real
 * lives: local dev, tests and `pr-<n>` previews. A production deploy is refused with no way around it; a production
 * build outside a preview (a local docker run) needs `SEED_ALLOW_PRODUCTION_BUILD=yes`.
 */
export function assertPreviewSeedAllowed(env: SeedEnv): void {
  if (env.DEPLOY_ENV === "production") {
    throw new SeedRefusedError(
      "SEED=preview is refused when DEPLOY_ENV=production: it creates accounts with a public password.",
    )
  }
  if (env.NODE_ENV === "production" && !PREVIEW_ENV.test(env.DEPLOY_ENV) && env.SEED_ALLOW_PRODUCTION_BUILD !== "yes") {
    throw new SeedRefusedError(
      "SEED=preview is refused on a production build outside a pr-<n> preview. Set SEED_ALLOW_PRODUCTION_BUILD=yes if this is a throwaway environment.",
    )
  }
}
