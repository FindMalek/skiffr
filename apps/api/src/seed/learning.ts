import { controlKind } from "@skiffr/ai"
import type { SiteFieldEntry, SiteFieldMap } from "@skiffr/common/schemas"
import type { answer, fieldEvent, siteProfile } from "@skiffr/db"
import { embeddingText, fingerprintOf } from "@skiffr/orpc/learning"
import { formFieldKeys, formSignature } from "@skiffr/orpc/site-profile"
import { fakeEmbedding } from "./embedding"
import { ANSWERS, type AnswerSpec, DEMO_PROFILE, type FormField, SHORT_FORM_LABELS, STANDARD_FORM } from "./fixtures"
import { DAY, seedId } from "./ids"
import type { SeedApplication, SeedJob } from "./jobs"

type Rand = () => number
type NewAnswer = typeof answer.$inferInsert
type NewEvent = typeof fieldEvent.$inferInsert
type NewSiteProfile = typeof siteProfile.$inferInsert

export const answerIdOf = (userId: string, label: string) =>
  seedId(userId, "answer", fingerprintOf({ label }).normalizedLabel)

/** The answer bank: every status, every source, usage counters, a fingerprint per field and a fake but stable embedding. */
export function buildAnswers(userId: string, specs: readonly AnswerSpec[], now: Date, rand: Rand): NewAnswer[] {
  return specs.map((spec) => {
    const { normalizedLabel, fingerprint } = fingerprintOf({
      label: spec.label,
      type: spec.type,
      options: spec.options,
    })
    const createdAt = new Date(now.getTime() - (6 + rand() * 62) * DAY)
    const touched = new Date(createdAt.getTime() + rand() * (now.getTime() - createdAt.getTime()))
    return {
      id: answerIdOf(userId, spec.label),
      userId,
      normalizedLabel,
      rawLabel: spec.label,
      value: spec.value,
      source: spec.source,
      status: spec.status,
      timesUsed: spec.used,
      timesCorrected: spec.corrected,
      timesCleared: spec.cleared,
      lastCorrectedAt: spec.corrected > 0 ? new Date(now.getTime() - (0.5 + rand() * 30) * DAY) : null,
      fingerprint,
      embedding: fakeEmbedding(embeddingText(normalizedLabel)),
      createdAt,
      updatedAt: touched,
    }
  })
}

const profileValue = (path: string): string => {
  const value = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], DEMO_PROFILE.data)
  return String(value ?? "")
}

const answerValue = (label: string): string => ANSWERS.find((spec) => spec.label === label)?.value ?? ""

const fieldValue = (field: FormField): string =>
  "profile" in field.from
    ? profileValue(field.from.profile)
    : "answer" in field.from
      ? answerValue(field.from.answer)
      : field.from.literal

/** `host`, plus the first path segment on the multi-tenant ATS hosts, as the extension builds it. */
export function siteKeyOf(url: string): string {
  const { hostname, pathname, port } = new URL(url)
  const host = `${hostname.toLowerCase()}${port ? `:${port}` : ""}`
  const tenant =
    /^(?:job-boards\.|boards\.)(?:eu\.)?greenhouse\.io$|^jobs\.(?:eu\.)?lever\.co$|^jobs\.ashbyhq\.com$|^apply\.workable\.com$/.test(
      hostname,
    )
  const first = pathname.split("/")[1]?.toLowerCase()
  return tenant && first ? `${host}/${first}` : host
}

const formKeys = (fields: readonly FormField[]) => fields.map((field) => fingerprintOf(field).fieldKey)

/** What the user left in each field of the standard form last time: answers still match their bank entry, edited values are plain literals. */
function fieldMapOf(userId: string, fields: readonly FormField[], now: Date, used: number): SiteFieldMap {
  const map: SiteFieldMap = {}
  for (const field of fields) {
    const { normalizedLabel, fieldKey } = fingerprintOf(field)
    const edited = field.corrected !== undefined && field.was === undefined
    const fromAnswer = "answer" in field.from && !edited
    const entry: SiteFieldEntry = {
      label: normalizedLabel,
      value: edited ? field.corrected! : fieldValue(field),
      kind: controlKind(field.type) ?? "text",
      source: fromAnswer ? "answer" : "profile" in field.from ? "profile" : "literal",
      savedAt: new Date(now.getTime() - 2 * DAY).toISOString(),
      timesUsed: used,
      timesCorrected: edited ? 1 : 0,
      timesCleared: 0,
    }
    if (fromAnswer && "answer" in field.from) entry.answerId = answerIdOf(userId, field.from.answer)
    map[fieldKey] = entry
  }
  return map
}

function siteProfileRow(
  userId: string,
  siteKey: string,
  fields: readonly FormField[],
  now: Date,
  used: number,
  lastUsedDaysAgo: number,
): NewSiteProfile {
  const keys = formFieldKeys(formKeys(fields))
  return {
    id: seedId(userId, "site", siteKey, keys.length),
    userId,
    siteKey,
    formSignature: formSignature(keys),
    fieldKeys: keys,
    fieldMap: fieldMapOf(userId, fields, now, used),
    timesUsed: used,
    lastUsedAt: new Date(now.getTime() - lastUsedDaysAgo * DAY),
    createdAt: new Date(now.getTime() - (lastUsedDaysAgo + 20) * DAY),
    updatedAt: new Date(now.getTime() - lastUsedDaysAgo * DAY),
  }
}

/** Saved forms of the sites the demo user applied on: the playground (or `jobs.example.invalid`) in two shapes, and three real ATS hosts. */
export function buildSiteProfiles(userId: string, baseUrl: string, now: Date): NewSiteProfile[] {
  const short = STANDARD_FORM.filter((field) => (SHORT_FORM_LABELS as readonly string[]).includes(field.label))
  const host = siteKeyOf(baseUrl)
  return [
    siteProfileRow(userId, host, STANDARD_FORM, now, 7, 1),
    siteProfileRow(userId, host, short, now, 2, 6),
    siteProfileRow(userId, "job-boards.greenhouse.io/brightwave", STANDARD_FORM, now, 4, 3),
    siteProfileRow(userId, "jobs.lever.co/cobalt-peak", STANDARD_FORM.slice(0, 11), now, 3, 9),
    siteProfileRow(userId, "jobs.ashbyhq.com/kestrel-ai", short, now, 2, 14),
    siteProfileRow(userId, "apply.workable.com/fernhill-systems", STANDARD_FORM, now, 1, 27),
  ]
}

const EXTRA_FIELDS: FormField[] = [
  "Years of experience with TypeScript",
  "Primary programming language",
  "Are you open to remote work?",
  "Contract type preference",
  "Time zone",
  "Are you currently employed?",
].map((label) => {
  const spec = ANSWERS.find((answer) => answer.label === label)!
  return { label, type: spec.type, options: spec.options, from: { answer: label } }
})

/**
 * What the extension filled and what was left in the field, one batch per application: mostly accepted, corrections
 * that get rarer as the bank learns, an occasional clear, and a share of fields filled from a saved site form.
 */
export function buildFieldEvents(
  userId: string,
  jobs: readonly SeedJob[],
  applications: readonly SeedApplication[],
  rand: Rand,
): NewEvent[] {
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const seenSites = new Set<string>()
  const events: NewEvent[] = []
  applications.forEach((application, n) => {
    const job = byId.get(application.jobId)!
    const siteKey = siteKeyOf(job.url)
    const progress = applications.length > 1 ? n / (applications.length - 1) : 1
    const correctedShare = 0.55 - 0.52 * progress
    const known = seenSites.has(siteKey)
    seenSites.add(siteKey)
    const fields = [
      ...STANDARD_FORM.filter((_field, i) => i < 4 || rand() > 0.2),
      ...EXTRA_FIELDS.filter(() => rand() < 0.4),
    ]
    for (const field of fields) {
      const { normalizedLabel, fingerprint } = fingerprintOf(field)
      const fromProfile = "profile" in field.from
      const generated = field.label.startsWith("Why do you want")
      const source = fromProfile ? "profile" : generated ? "ai" : known && rand() < 0.6 ? "site" : "answer"
      const early = field.was !== undefined && progress < 0.5
      const filledValue = early ? field.was! : fieldValue(field)
      const roll = rand()
      const canCorrect = field.corrected !== undefined && (field.was === undefined || early)
      const outcome =
        roll < 0.04
          ? "cleared"
          : canCorrect && roll < 0.04 + (generated ? 0.5 : early ? 0.8 : correctedShare)
            ? "corrected"
            : "accepted"
      events.push({
        id: seedId(userId, "event", events.length),
        userId,
        applicationId: application.id,
        siteKey,
        fingerprint,
        normalizedLabel,
        rawLabel: field.label,
        fieldType: field.type,
        filledValue,
        finalValue:
          outcome === "accepted"
            ? filledValue
            : outcome === "cleared"
              ? ""
              : field.correctedAlt && rand() < 0.5
                ? field.correctedAlt
                : field.corrected!,
        source,
        outcome,
        createdAt: new Date(application.appliedAt.getTime() - (5 + rand() * 35) * 60_000),
      })
    }
  })
  return events
}
