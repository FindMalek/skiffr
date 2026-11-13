import { type Db, job } from "@skiffr/db"
import { and, asc, eq } from "drizzle-orm"
import { ADMIN_USER, DEMO_USER, SECOND_USER } from "./fixtures"
import { dedupeVariants } from "./jobs"

export interface SeedLinks {
  /** What the preview tooling prints: sign-in details, the extension token, pages worth opening and urls that test dedupe and escaping. */
  users: { demo: Credential; admin: Credential; second: Credential }
  extensionToken: string
  dashboard: Record<
    "signIn" | "queue" | "stats" | "statsNinetyDays" | "answers" | "sources" | "cv" | "gmail" | "extension" | "users",
    string
  >
  playground: { base: string; nextJob: string; jobs: string[] } | null
  dedupe: { url: string; matches: string }[]
  escaping: { title: string; company: string } | null
}

interface Credential {
  email: string
  password: string
  role: "admin" | "user"
}

export interface LinkInput {
  dashboardUrl: string
  password: string
  extensionToken: string
  playgroundUrl?: string
}

/** Everything is read back from the database, so it is right for a rerun that seeded nothing and for a seed made at another time. */
export async function readSeedLinks(db: Db, input: LinkInput): Promise<SeedLinks> {
  const dash = input.dashboardUrl.replace(/\/+$/, "")
  const queued = await db
    .select()
    .from(job)
    .where(and(eq(job.userId, DEMO_USER.id), eq(job.status, "queued")))
    .orderBy(asc(job.queuedAt), asc(job.id))
  const hostile = queued.find((row) => row.title.includes("<img"))
  const credential = (user: { email: string; role: "admin" | "user" }): Credential => ({
    email: user.email,
    password: input.password,
    role: user.role,
  })
  const playground = input.playgroundUrl
    ? {
        base: input.playgroundUrl,
        nextJob: queued[0]?.url ?? input.playgroundUrl,
        jobs: queued
          .filter((row) => row.url.startsWith(input.playgroundUrl!))
          .slice(0, 8)
          .map((row) => row.url),
      }
    : null
  return {
    users: { demo: credential(DEMO_USER), admin: credential(ADMIN_USER), second: credential(SECOND_USER) },
    extensionToken: input.extensionToken,
    dashboard: {
      signIn: `${dash}/sign-in`,
      queue: `${dash}/queue`,
      stats: `${dash}/stats`,
      statsNinetyDays: `${dash}/stats?days=90`,
      answers: `${dash}/answers`,
      sources: `${dash}/settings/sources`,
      cv: `${dash}/settings/cv`,
      gmail: `${dash}/settings/gmail`,
      extension: `${dash}/settings/extension`,
      users: `${dash}/users`,
    },
    playground,
    dedupe: dedupeVariants(queued).map((variant) => ({ url: variant.url, matches: variant.title })),
    escaping: hostile ? { title: hostile.title, company: hostile.company } : null,
  }
}

/** The PR comment: credentials first, then the pages worth clicking. */
export function seedLinksMarkdown(links: SeedLinks): string {
  const lines = [
    "### seeded preview data",
    "",
    `sign in at ${links.dashboard.signIn}`,
    "",
    "| user | email | password |",
    "| --- | --- | --- |",
    ...Object.entries(links.users).map(
      ([name, user]) => `| ${name} (${user.role}) | \`${user.email}\` | \`${user.password}\` |`,
    ),
    "",
    `extension token for the demo user: \`${links.extensionToken}\``,
    "",
    `- queue: ${links.dashboard.queue}`,
    `- stats: ${links.dashboard.stats} (90 days: ${links.dashboard.statsNinetyDays})`,
    `- answers: ${links.dashboard.answers}`,
    `- sources: ${links.dashboard.sources}`,
    `- cv: ${links.dashboard.cv}`,
    `- gmail: ${links.dashboard.gmail}`,
    `- extension: ${links.dashboard.extension}`,
    `- admin users: ${links.dashboard.users}`,
  ]
  if (links.playground) {
    lines.push("", `playground: ${links.playground.base}`, `- next job in the queue: ${links.playground.nextJob}`)
    for (const url of links.playground.jobs.slice(0, 5)) lines.push(`- ${url}`)
  }
  return lines.join("\n")
}
