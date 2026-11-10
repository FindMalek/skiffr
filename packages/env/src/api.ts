import { z } from "zod"
import { parseEnv } from "./parse"

const optional = z.string().optional()

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  /** "production", "pr-<n>" for previews, or "local". */
  DEPLOY_ENV: z.string().default("local"),
  DATABASE_URL: z.string().min(1),
  SEED: z.enum(["none", "demo"]).default("demo"),

  /** Public origins: the api's own, and the two apps that proxy to it. */
  API_PUBLIC_URL: z.url().default("http://localhost:3001"),
  WEB_URL: z.url().default("http://localhost:3000"),
  DASHBOARD_URL: z.url().default("http://localhost:3002"),

  BETTER_AUTH_SECRET: z.string().min(32),
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  /** First admin, created (or its password reset) on every start. */
  ADMIN_EMAIL: optional,
  ADMIN_PASSWORD: optional,

  /** Public repo shown on the landing page (owner/name). */
  GITHUB_REPO: optional,
  GITHUB_TOKEN: optional,

  S3_ENDPOINT: optional,
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,

  AI_MODEL: z.string().default("groq:openai/gpt-oss-120b"),
  GROQ_API_KEY: optional,
  OPENAI_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
})

export type ApiEnv = z.infer<typeof schema>
export const loadApiEnv = (source?: Record<string, string | undefined>) => parseEnv(schema, source)
