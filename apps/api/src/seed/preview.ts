import { createHash } from "node:crypto"
import type { Auth } from "@skiffr/auth"
import { GMAIL_SCOPE } from "@skiffr/common/constants"
import {
  account,
  answer,
  apiToken,
  application,
  cvConnection,
  type Db,
  fieldEvent,
  gmailAccount,
  gmailMessage,
  gmailMessageJob,
  job,
  jobSource,
  notes,
  profile,
  siteProfile,
  user,
} from "@skiffr/db"
import { buildScenario, random } from "@skiffr/db/seed"
import { sealApiKey } from "@skiffr/orpc/cv"
import { DEFAULT_SENDERS } from "@skiffr/orpc/gmail"
import { and, eq, inArray, ne, notInArray, or, sql } from "drizzle-orm"
import {
  ADMIN_PROFILE,
  ADMIN_USER,
  ANSWERS,
  DEMO_PROFILE,
  DEMO_USER,
  NOTES,
  PREVIEW_USERS,
  type PreviewUser,
  SECOND_ANSWERS,
  SECOND_NOTES,
  SECOND_PROFILE,
  SECOND_USER,
} from "./fixtures"
import { DAY, HOUR, seedId } from "./ids"
import { buildPipeline, FULL_PIPELINE, type PipelineSize, type SeedApplication, type SeedJob, WATCHED } from "./jobs"
import { buildAnswers, buildFieldEvents, buildSiteProfiles } from "./learning"
import { type LinkInput, readSeedLinks, type SeedLinks } from "./links"

const SEED = 20261112
const CHUNK = 200
const SEED_LOCK = "skiffr:seed-preview"
const PLACEHOLDER_REFRESH_TOKEN = "seed.not-a-real-token"
const EXAMPLE_BASE = "https://careers.example.invalid"
// The key and url of the mock Reactive Resume in `@skiffr/orpc/cv-test`, copied so the api never loads a test module.
const MOCK_RR_KEY = "rr-test-key-0123456789abcdef"
const MOCK_RR_URL = "https://rr.test"

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export class SeedConflictError extends Error {
  override name = "SeedConflictError"
}

export interface PreviewSeedOptions {
  password: string
  dashboardUrl: string
  /** Wipes the preview users and everything of theirs first, so the dates are relative to `now` again. */
  reset?: boolean
  now?: Date
  playgroundUrl?: string
  /** The 32 byte key the api seals cv api keys with. Without it no cv connection is seeded. */
  cvKey?: Buffer
  cvUrl?: string
  /** Refuse to seed when the database already holds users that are not the seed's own (and not `adminEmail`). Off in `pr-<n>` previews, where testers sign up. */
  refuseOtherUsers?: boolean
  adminEmail?: string
}

export interface PreviewSeedResult {
  seeded: boolean
  links: SeedLinks
  skipped: string[]
}

/** The secret of a seeded extension token: stable, so the link tooling can print it and a rerun keeps it working. */
export const tokenSecret = (userId: string, name: string) =>
  `skp_${createHash("sha256").update(`seed-token|${userId}|${name}`).digest("base64url")}`

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

async function insertAll<T>(rows: T[], insert: (chunk: T[]) => PromiseLike<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK))
}

function tokensOf(userId: string, now: Date, withHistory: boolean) {
  const row = (name: string, extra: Partial<typeof apiToken.$inferInsert>) => {
    const secret = tokenSecret(userId, name)
    return {
      id: seedId(userId, "token", name),
      userId,
      name,
      prefix: secret.slice(0, 8),
      last4: secret.slice(-4),
      tokenHash: sha256(secret),
      createdAt: new Date(now.getTime() - 30 * DAY),
      ...extra,
    }
  }
  const active = row("Chrome on laptop", { lastUsedAt: new Date(now.getTime() - 2 * HOUR) })
  if (!withHistory) return { active, rows: [active] }
  return {
    active,
    rows: [
      active,
      row("Work machine", {
        createdAt: new Date(now.getTime() - 45 * DAY),
        expiresAt: new Date(now.getTime() + 60 * DAY),
        lastUsedAt: new Date(now.getTime() - 9 * DAY),
      }),
      row("Old laptop", {
        createdAt: new Date(now.getTime() - 120 * DAY),
        revokedAt: new Date(now.getTime() - 20 * DAY),
        lastUsedAt: new Date(now.getTime() - 21 * DAY),
      }),
      row("Trial token", {
        createdAt: new Date(now.getTime() - 40 * DAY),
        expiresAt: new Date(now.getTime() - 3 * DAY),
      }),
    ],
  }
}

function jobSources(userId: string, base: string, now: Date, jobs: readonly SeedJob[]) {
  const seen = (label: string) => jobs.filter((row) => row.source === `watch:${label}`).map((row) => row.canonicalId)
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const ahead = (ms: number) => new Date(now.getTime() + ms)
  const common = { userId, createdAt: ago(60 * DAY), updatedAt: ago(HOUR) }
  const [brightmere, cobalt, kestrel] = WATCHED
  const healthy = (watched: (typeof WATCHED)[number], checked: number, found: number, added: number) => ({
    ...common,
    id: seedId(userId, "source", watched.label),
    url: `${base}/careers/${watched.slug}`,
    label: watched.label,
    kind: watched.vendor,
    status: "ok" as const,
    lastCheckedAt: ago(checked),
    nextAttemptAt: ahead(60 * 60_000 - checked),
    lastFound: found,
    lastAdded: added,
    seenIds: seen(watched.label),
  })
  return [
    healthy(brightmere, 40 * 60_000, 14, 3),
    healthy(cobalt, 2 * HOUR, 9, 2),
    healthy(kestrel, 5 * HOUR, 22, 4),
    {
      ...common,
      id: seedId(userId, "source", "Initech feed"),
      url: `${base}/feeds/initech.xml`,
      label: "Initech feed",
      kind: "feed" as const,
      status: "error" as const,
      lastError: "timeout",
      failures: 4,
      lastCheckedAt: ago(3 * HOUR),
      nextAttemptAt: ahead(6 * HOUR),
    },
    {
      ...common,
      id: seedId(userId, "source", "Umbrella careers"),
      url: `${base}/careers/umbrella`,
      label: "Umbrella careers",
      kind: "html" as const,
      enabled: false,
      status: "ok" as const,
      lastCheckedAt: ago(9 * DAY),
      lastFound: 6,
      lastAdded: 0,
    },
    {
      ...common,
      id: seedId(userId, "source", "Hooli"),
      url: `${base}/careers/hooli`,
      label: "Hooli",
      kind: "auto" as const,
      status: "pending" as const,
      nextAttemptAt: ahead(HOUR),
    },
  ]
}

/** One mailbox that needs to be reconnected (no real token exists), and the mails it already read: a row per imported gmail job plus the other outcomes. */
function gmailRows(userId: string, now: Date, jobs: readonly SeedJob[]) {
  const accountId = seedId(userId, "gmail")
  const imported = jobs.filter((row) => row.source.startsWith("gmail:"))
  const messages = imported.map((row, i) => ({
    id: seedId(userId, "message", i),
    userId,
    accountId,
    googleMessageId: `seed-msg-${String(i).padStart(4, "0")}`,
    provider: row.source.slice("gmail:".length),
    outcome: "imported" as const,
    jobsFound: 1,
    jobsNew: 1,
    processedAt: new Date(row.queuedAt.getTime() + 60_000),
    modifiedAt: new Date(row.queuedAt.getTime() + 120_000),
  }))
  const others = (["duplicate", "duplicate", "no_jobs", "no_jobs", "no_jobs", "skipped", "failed"] as const).map(
    (outcome, i) => ({
      id: seedId(userId, "message", imported.length + i),
      userId,
      accountId,
      googleMessageId: `seed-msg-${String(imported.length + i).padStart(4, "0")}`,
      provider: ["linkedin", "indeed", "other", "glassdoor"][i % 4]!,
      outcome,
      jobsFound: outcome === "duplicate" ? 2 : 0,
      jobsNew: 0,
      processedAt: new Date(now.getTime() - (1 + i * 3) * DAY),
      modifiedAt: outcome === "failed" ? null : new Date(now.getTime() - (1 + i * 3) * DAY + 60_000),
    }),
  )
  return {
    account: {
      id: accountId,
      userId,
      email: "jordan.jobs@gmail.test",
      refreshTokenEnc: PLACEHOLDER_REFRESH_TOKEN,
      scopes: GMAIL_SCOPE,
      status: "needs_reconnect" as const,
      labelId: "Label_seed_skiffr_jobs",
      senders: [...DEFAULT_SENDERS],
      lastSyncAt: new Date(now.getTime() - 2 * DAY),
      lastError: "auth",
      createdAt: new Date(now.getTime() - 60 * DAY),
      updatedAt: new Date(now.getTime() - 2 * DAY),
    },
    messages: [...messages, ...others],
    links: messages.map((message, i) => ({ messageId: message.id, jobId: imported[i]!.id })),
  }
}

function userRow(spec: PreviewUser, now: Date, daysAgo: number): typeof user.$inferInsert {
  const createdAt = new Date(now.getTime() - daysAgo * DAY)
  return {
    id: spec.id,
    name: spec.name,
    email: spec.email,
    emailVerified: true,
    role: spec.role,
    createdAt,
    updatedAt: createdAt,
  }
}

async function setPasswords(db: Tx, auth: Auth, password: string): Promise<void> {
  const ctx = await auth.$context
  const hash = await ctx.password.hash(password)
  for (const spec of PREVIEW_USERS) {
    await db.update(account).set({ password: hash }).where(eq(account.userId, spec.id))
  }
}

/** The preview users share one password, so one hash serves all three. */
async function accountRows(auth: Auth, password: string, now: Date) {
  const hash = await (await auth.$context).password.hash(password)
  return PREVIEW_USERS.map((spec) => ({
    id: `${spec.id}-credential`,
    accountId: spec.id,
    providerId: "credential",
    userId: spec.id,
    password: hash,
    createdAt: now,
    updatedAt: now,
  }))
}

const profileRow = (
  userId: string,
  source: { data: typeof DEMO_PROFILE.data; fields: typeof DEMO_PROFILE.fields },
  now: Date,
  daysAgo: number,
) => ({
  id: seedId(userId, "profile"),
  userId,
  data: source.data,
  fields: source.fields,
  createdAt: new Date(now.getTime() - (daysAgo + 10) * DAY),
  updatedAt: new Date(now.getTime() - daysAgo * DAY),
})

const jobRow = (userId: string, row: SeedJob): typeof job.$inferInsert => ({
  id: row.id,
  userId,
  url: row.url,
  canonicalId: row.canonicalId,
  title: row.title,
  company: row.company,
  source: row.source,
  status: row.status,
  queuedAt: row.queuedAt,
  createdAt: row.queuedAt,
  updatedAt: row.updatedAt,
})

const applicationRow = (userId: string, row: SeedApplication): typeof application.$inferInsert => ({
  ...row,
  userId,
  createdAt: row.appliedAt,
  updatedAt:
    [row.rejectedAt, row.offerAt, row.interviewAt, row.respondedAt, row.appliedAt].find(Boolean) ?? row.appliedAt,
})

async function insertPipeline(tx: Tx, userId: string, jobs: SeedJob[], applications: SeedApplication[]): Promise<void> {
  await insertAll(jobs, (chunk) => tx.insert(job).values(chunk.map((row) => jobRow(userId, row))))
  await insertAll(applications, (chunk) =>
    tx.insert(application).values(chunk.map((row) => applicationRow(userId, row))),
  )
}

const noteRows = (userId: string, source: readonly { title: string; body: string }[], now: Date) =>
  source.map((note, i) => {
    const createdAt = new Date(now.getTime() - (3 + i * 9) * DAY)
    return { id: seedId(userId, "note", i), userId, ...note, pinned: i === 0, createdAt, updatedAt: createdAt }
  })

/**
 * Fills the database with the preview dataset: three accounts (`demo`, `admin`, `second`, one password) and, for the demo
 * user, a complete product state. Deterministic and relative to `now`. A database that already has the demo user is left
 * alone (only the password is reset to the given one); `reset` wipes the preview users (by id) first.
 * Never touches other users: a real account on a preview email stops the seed, with or without reset.
 * The caller decides whether seeding is allowed here (`assertPreviewSeedAllowed`).
 */
export async function seedPreview(db: Db, auth: Auth, options: PreviewSeedOptions): Promise<PreviewSeedResult> {
  const now = options.now ?? new Date()
  const rand = random(SEED)
  const base = options.playgroundUrl ?? EXAMPLE_BASE
  const scenario = buildScenario(now, { ownerId: ADMIN_USER.id })
  const scenarioIds = scenario.users.map((row) => row.id!)
  const ids = [...PREVIEW_USERS.map((spec) => spec.id), ...scenarioIds]
  const emails = [...PREVIEW_USERS.map((spec) => spec.email), ...scenario.users.map((row) => row.email)]
  const skipped: string[] = []
  const link: LinkInput = {
    dashboardUrl: options.dashboardUrl,
    password: options.password,
    playgroundUrl: options.playgroundUrl,
    extensionToken: tokenSecret(DEMO_USER.id, "Chrome on laptop"),
  }

  const accounts = await accountRows(auth, options.password, now)
  const demo = buildPipeline({ userId: DEMO_USER.id, now, rand, playgroundUrl: options.playgroundUrl }, FULL_PIPELINE)
  const sized = (size: PipelineSize, userId: string) =>
    buildPipeline({ userId, now, rand, playgroundUrl: options.playgroundUrl }, size)
  const second = sized({ applied: 6, queued: 8, skipped: 3 }, SECOND_USER.id)
  const admin = sized({ applied: 0, queued: 4, skipped: 0 }, ADMIN_USER.id)
  // The second user has one posting in common with the demo user, to prove the unique ids are per user.
  const shared = demo.jobs.find((row) => row.status === "queued")!
  second.jobs[second.jobs.length - 1] = {
    ...second.jobs[second.jobs.length - 1]!,
    url: shared.url,
    canonicalId: shared.canonicalId,
    ats: shared.ats,
  }

  const gmail = gmailRows(DEMO_USER.id, now, demo.jobs)
  const tokens = [DEMO_USER, SECOND_USER, ADMIN_USER].map((spec) => tokensOf(spec.id, now, spec.id === DEMO_USER.id))
  if (!options.cvKey) skipped.push("cv connection (set CV_ENCRYPTION_KEY)")

  const seeded = await db.transaction(async (tx) => {
    // One seeder at a time, and the checks below read what the previous one committed.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${SEED_LOCK}))`)
    const present = await tx
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(or(inArray(user.id, ids), inArray(user.email, emails)))
    const stranger = present.find((row) => emails.includes(row.email) && !ids.includes(row.id))
    if (stranger) {
      throw new SeedConflictError(
        `${stranger.email} belongs to a real account. The seed never replaces it, not even with reset: change that account's email first.`,
      )
    }
    if (present.some((row) => row.id === DEMO_USER.id) && !options.reset) {
      await setPasswords(tx, auth, options.password)
      return false
    }
    if (options.refuseOtherUsers) {
      const [other] = await tx
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            notInArray(user.id, ids),
            options.adminEmail ? ne(user.email, options.adminEmail.toLowerCase()) : undefined,
          ),
        )
        .limit(1)
      if (other) {
        throw new SeedConflictError(
          "The database already has accounts that are not preview users. SEED=preview only runs on an empty database or in a pr-<n> preview.",
        )
      }
    }
    await tx.delete(user).where(inArray(user.id, ids))
    await tx
      .insert(user)
      .values([
        userRow(DEMO_USER, now, 80),
        userRow(ADMIN_USER, now, 120),
        userRow(SECOND_USER, now, 30),
        ...scenario.users,
      ])
    await tx.insert(account).values(accounts)
    await tx
      .insert(profile)
      .values([
        profileRow(DEMO_USER.id, DEMO_PROFILE, now, 20),
        profileRow(ADMIN_USER.id, ADMIN_PROFILE, now, 50),
        profileRow(SECOND_USER.id, SECOND_PROFILE, now, 12),
      ])
    await insertAll(buildAnswers(DEMO_USER.id, ANSWERS, now, rand), (chunk) => tx.insert(answer).values(chunk))
    await tx.insert(answer).values(buildAnswers(SECOND_USER.id, SECOND_ANSWERS, now, rand))
    await tx.insert(siteProfile).values(buildSiteProfiles(DEMO_USER.id, base, now))
    await insertPipeline(tx, DEMO_USER.id, demo.jobs, demo.applications)
    await insertPipeline(tx, SECOND_USER.id, second.jobs, second.applications)
    await insertPipeline(tx, ADMIN_USER.id, admin.jobs, admin.applications)
    await insertAll(buildFieldEvents(DEMO_USER.id, demo.jobs, demo.applications, rand), (chunk) =>
      tx.insert(fieldEvent).values(chunk),
    )
    await tx.insert(jobSource).values(jobSources(DEMO_USER.id, base, now, demo.jobs))
    await tx.insert(gmailAccount).values(gmail.account)
    await insertAll(gmail.messages, (chunk) => tx.insert(gmailMessage).values(chunk))
    await insertAll(gmail.links, (chunk) => tx.insert(gmailMessageJob).values(chunk))
    await tx.insert(apiToken).values(tokens.flatMap((set) => set.rows))
    if (options.cvKey) {
      await tx.insert(cvConnection).values({
        id: seedId(DEMO_USER.id, "cv"),
        userId: DEMO_USER.id,
        baseUrl: options.cvUrl ?? MOCK_RR_URL,
        apiKeyEnc: sealApiKey(options.cvKey, MOCK_RR_KEY, DEMO_USER.id),
        keyLast4: MOCK_RR_KEY.slice(-4),
        baseResumeId: "base-1",
        baseResumeName: "Master CV",
        createdAt: new Date(now.getTime() - 40 * DAY),
        updatedAt: new Date(now.getTime() - 40 * DAY),
      })
    }
    await tx
      .insert(notes)
      .values([
        ...noteRows(DEMO_USER.id, NOTES, now),
        ...noteRows(SECOND_USER.id, SECOND_NOTES, now),
        ...noteRows(
          ADMIN_USER.id,
          [{ title: "Admin checklist", body: "Check the users page, ban and unban the unverified ones." }],
          now,
        ),
        ...scenario.notes,
      ])
    return true
  })

  return { seeded, links: await readSeedLinks(db, link), skipped }
}
