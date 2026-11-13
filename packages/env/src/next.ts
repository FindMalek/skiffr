import { z } from "zod"
import { parseEnv } from "./parse"

const schema = z.object({
  /** Where the Next server reaches the api: http://localhost:3001 locally, the api service inside the cluster. */
  API_URL: z.url().default("http://localhost:3001"),
  WEB_URL: z.url().default("http://localhost:3000"),
  API_PUBLIC_URL: z.url().default("http://localhost:3001"),
  DASHBOARD_URL: z.url().default("http://localhost:3002"),
  /** The docs site, for links from the dashboard. */
  DOCS_URL: z.url().optional(),
  /** Umami page analytics, read at request time (never baked into the build). Off until both are set; a bad value turns it off and never breaks a page. */
  UMAMI_URL: z.string().optional(),
  UMAMI_WEBSITE_ID: z.string().optional(),
})

export const nextEnv = () => parseEnv(schema)
