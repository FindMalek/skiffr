import { statusSchema } from "@skiffr/common/schemas"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { repoInfo } from "../lib/github"
import { publicProcedure } from "../procedures"

export const publicRouter = {
  status: publicProcedure
    .route({ method: "GET", path: "/public/status", summary: "Live api and database health", tags: ["public"] })
    .output(statusSchema)
    .handler(async ({ context }) => {
      const started = performance.now()
      const up = await context.db
        .execute(sql`select 1`)
        .then(() => true)
        .catch(() => false)
      return {
        api: "ok" as const,
        database: up ? ("ok" as const) : ("down" as const),
        databaseMs: up ? Math.round(performance.now() - started) : null,
        env: context.config.deployEnv,
      }
    }),

  repo: publicProcedure
    .route({ method: "GET", path: "/public/repo", summary: "The project's GitHub repo and stars", tags: ["public"] })
    .output(z.object({ name: z.string(), url: z.string(), stars: z.number() }).nullable())
    .handler(async ({ context }) => {
      const info = await repoInfo(context.config.githubRepo, context.config.githubToken)
      return info && context.config.githubRepo ? { name: context.config.githubRepo, ...info } : null
    }),

  authProviders: publicProcedure
    .route({ method: "GET", path: "/public/auth-providers", summary: "Sign-in methods enabled here", tags: ["public"] })
    .output(z.object({ email: z.boolean(), github: z.boolean(), passwordReset: z.boolean() }))
    .handler(({ context }) => ({
      email: true,
      github: context.config.githubAuth,
      // better-auth only exposes the reset endpoints when `sendResetPassword` was passed to `createAuth`.
      passwordReset: Boolean(context.auth.options.emailAndPassword?.sendResetPassword),
    })),
}
