import { ORPCError } from "@orpc/server"
import { embedTexts, isLearnableQuestion, isSensitiveValue } from "@skiffr/ai"
import {
  CLEARED_STOP_MIN,
  FIELD_EVENT_PURGE_BATCH,
  FIELD_EVENT_RETENTION_DAYS,
  LEARNING_AUTOFILL_VALUE_MAX,
  SIMILARITY_MARGIN,
  SIMILARITY_MIN,
  SITE_PROFILE_RETENTION_DAYS,
  SITE_PROFILES_PER_SITE_MAX,
  SUGGEST_FLIP_FLOP_MIN,
  SUGGEST_KEEP_MIN,
  SUGGEST_STABLE_RUN,
  SUGGEST_STALE_DAYS,
  SUGGEST_WINDOW_DAYS,
} from "@skiffr/common/constants"
import {
  answerSchema,
  forgetSiteInputSchema,
  forgetSiteOutputSchema,
  lookupInputSchema,
  lookupOutputSchema,
  recordInputSchema,
  recordOutputSchema,
  resolveSuggestionInputSchema,
  type SiteFieldMap,
  siteProfilesInputSchema,
  siteProfilesOutputSchema,
  statsInputSchema,
  statsOutputSchema,
  suggestionsOutputSchema,
} from "@skiffr/common/schemas"
import {
  answer,
  answerColumns,
  application,
  type Db,
  fieldEvent,
  findSimilarAnswersMany,
  profile,
  recordBatch,
  siteProfile,
} from "@skiffr/db"
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm"
import {
  embeddingText,
  embedMissing,
  fingerprintOf,
  guardLearningDb,
  labelsWithoutRoom,
  logBestEffort,
  payloadHash,
  usableValue,
} from "../lib/learning"
import { mine, orNotFound } from "../lib/owned"
import { flaggedKeys, verdictKey } from "../lib/sensitive-verdicts"
import {
  applyEvents,
  entryIsFresh,
  evictLeastRecent,
  formFieldKeys,
  formSignature,
  isPartialForm,
  pickAlikeForm,
  type SiteEvent,
  stopsAutofill,
  withSiteLock,
} from "../lib/site-profile"
import { protectedProcedure } from "../procedures"

const DAY_MS = 86_400_000
const SUGGESTION_EVENTS_MAX = 1_000
const NEIGHBOURS = 3

type Outcome = "accepted" | "corrected" | "cleared"

function outcomeOf(filled: string, final: string): Outcome | null {
  if (!filled && !final) return null
  if (!final) return "cleared"
  return final === filled ? "accepted" : "corrected"
}

/** Old events and spent batch ids go, a bounded slice per call. Best effort: the write that triggered it already succeeded. */
async function purgeOld(db: Db, userId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - FIELD_EVENT_RETENTION_DAYS * DAY_MS)
  const siteCutoff = new Date(now.getTime() - SITE_PROFILE_RETENTION_DAYS * DAY_MS)
  try {
    await db.delete(fieldEvent).where(
      inArray(
        fieldEvent.id,
        db
          .select({ id: fieldEvent.id })
          .from(fieldEvent)
          .where(and(eq(fieldEvent.userId, userId), lt(fieldEvent.createdAt, cutoff)))
          .limit(FIELD_EVENT_PURGE_BATCH),
      ),
    )
    await db.delete(recordBatch).where(
      and(
        eq(recordBatch.userId, userId),
        inArray(
          recordBatch.batchId,
          db
            .select({ id: recordBatch.batchId })
            .from(recordBatch)
            .where(and(eq(recordBatch.userId, userId), lt(recordBatch.createdAt, cutoff)))
            .limit(FIELD_EVENT_PURGE_BATCH),
        ),
      ),
    )
    await db.delete(siteProfile).where(
      inArray(
        siteProfile.id,
        db
          .select({ id: siteProfile.id })
          .from(siteProfile)
          .where(and(eq(siteProfile.userId, userId), lt(siteProfile.lastUsedAt, siteCutoff)))
          .limit(FIELD_EVENT_PURGE_BATCH),
      ),
    )
  } catch (error) {
    logBestEffort("learning.record", "purge failed", error)
  }
}

/** The most alike saved form of the site (at least 80% of its fields in common), with its map: only that row's map is read. */
async function findAlikeForm(db: Pick<Db, "select">, userId: string, siteKey: string, keys: string[]) {
  const candidates = await db
    .select({ id: siteProfile.id, fieldKeys: siteProfile.fieldKeys, lastUsedAt: siteProfile.lastUsedAt })
    .from(siteProfile)
    .where(and(eq(siteProfile.userId, userId), eq(siteProfile.siteKey, siteKey)))
    .orderBy(desc(siteProfile.lastUsedAt), desc(siteProfile.id))
    .limit(SITE_PROFILES_PER_SITE_MAX)
  const alike = pickAlikeForm(candidates, keys)
  if (!alike) return null
  const [row] = await db
    .select({ fieldMap: siteProfile.fieldMap })
    .from(siteProfile)
    .where(eq(siteProfile.id, alike.id))
  return row ?? null
}

/** The saved form for these fields: the exact one by its key, else the most alike. */
async function findSavedForm(db: Db, userId: string, siteKey: string, keys: string[]) {
  const [exact] = await db
    .select({ fieldMap: siteProfile.fieldMap })
    .from(siteProfile)
    .where(
      and(
        eq(siteProfile.userId, userId),
        eq(siteProfile.siteKey, siteKey),
        eq(siteProfile.formSignature, formSignature(keys)),
      ),
    )
  return exact ?? (await findAlikeForm(db, userId, siteKey, keys))
}

type SiteProfileStatus = {
  status: "saved" | "skipped"
  reason?: "no_learnable_fields"
  warning?: "partial_form"
}

/** Folds a batch into the site profile of its form. `withSiteLock` makes it the last lock of the transaction, after the answers. */
async function saveSiteProfile(
  tx: Pick<Db, "select" | "insert" | "delete" | "execute">,
  userId: string,
  siteKey: string,
  keys: string[],
  events: {
    event: { type?: string; source: SiteEvent["source"] }
    filled: string
    final: string
    outcome: SiteEvent["outcome"]
    normalizedLabel: string
    fieldKey: string
  }[],
  now: Date,
): Promise<SiteProfileStatus> {
  return withSiteLock(tx, userId, async () => {
    const signature = formSignature(keys)
    const [existing] = await tx
      .select({ id: siteProfile.id, fieldMap: siteProfile.fieldMap })
      .from(siteProfile)
      .where(
        and(eq(siteProfile.userId, userId), eq(siteProfile.siteKey, siteKey), eq(siteProfile.formSignature, signature)),
      )
    let warning: SiteProfileStatus["warning"]
    let previous: SiteFieldMap = {}
    if (!existing) {
      const [latest] = await tx
        .select({ fieldKeys: siteProfile.fieldKeys })
        .from(siteProfile)
        .where(and(eq(siteProfile.userId, userId), eq(siteProfile.siteKey, siteKey)))
        .orderBy(desc(siteProfile.lastUsedAt), desc(siteProfile.id))
        .limit(1)
      if (latest && isPartialForm(latest.fieldKeys, keys)) warning = "partial_form"
      previous = (await findAlikeForm(tx, userId, siteKey, keys))?.fieldMap ?? {}
    }
    const fromAnswers = events.filter((e) => e.outcome === "accepted" && e.event.source === "answer")
    const globals = fromAnswers.length
      ? await tx
          .select({ id: answer.id, normalizedLabel: answer.normalizedLabel, value: answer.value })
          .from(answer)
          .where(
            and(
              eq(answer.userId, userId),
              inArray(
                answer.normalizedLabel,
                fromAnswers.map((e) => e.normalizedLabel),
              ),
            ),
          )
      : []
    const siteEvents: SiteEvent[] = events.map((e) => ({
      fieldKey: e.fieldKey,
      normalizedLabel: e.normalizedLabel,
      type: e.event.type,
      outcome: e.outcome,
      filled: e.filled,
      final: e.final,
      source: e.event.source,
      answerId: globals.find((g) => g.normalizedLabel === e.normalizedLabel && g.value === e.final)?.id,
    }))
    const { fieldMap, accepted } = applyEvents(existing?.fieldMap ?? {}, siteEvents, now, previous)
    if (!existing && Object.keys(fieldMap).length === 0) return { status: "skipped", reason: "no_learnable_fields" }
    const used = accepted > 0 ? 1 : 0
    const [saved] = await tx
      .insert(siteProfile)
      .values({
        userId,
        siteKey,
        formSignature: signature,
        fieldKeys: keys,
        fieldMap,
        timesUsed: used,
        lastUsedAt: now,
      })
      .onConflictDoUpdate({
        target: [siteProfile.userId, siteProfile.siteKey, siteProfile.formSignature],
        set: { fieldMap, timesUsed: sql`${siteProfile.timesUsed} + ${used}`, lastUsedAt: now, updatedAt: now },
      })
      .returning({ id: siteProfile.id })
    if (!existing && saved) await evictLeastRecent(tx, userId, siteKey, saved.id)
    return warning ? { status: "saved", warning } : { status: "saved" }
  })
}

export const learningRouter = {
  lookup: protectedProcedure
    .route({
      method: "POST",
      path: "/learning/lookup",
      summary: "Best saved answer per form field: exact, same label, then similar question",
      tags: ["learning"],
    })
    .input(lookupInputSchema)
    .output(lookupOutputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      const flagged = await guardLearningDb("lookup", () => flaggedKeys(context.db, context.now(), input.fields))
      const fields = input.fields.map((field) => ({
        field,
        ...fingerprintOf(field),
        learnable: isLearnableQuestion(field) && !flagged.has(verdictKey(field) ?? ""),
      }))
      const usable = fields.filter((f) => f.learnable && f.normalizedLabel)
      const keys = usable.map((f) => f.fieldKey)
      const saved = usable.length === 0 ? null : await findSavedForm(context.db, userId, input.siteKey, keys)
      const profileUpdatedAt = Object.values(saved?.fieldMap ?? {}).some((entry) => entry.source === "profile")
        ? (await context.db.select({ updatedAt: profile.updatedAt }).from(profile).where(eq(profile.userId, userId)))[0]
            ?.updatedAt
        : null
      const rows =
        usable.length === 0
          ? []
          : await context.db
              .select(answerColumns)
              .from(answer)
              .where(
                and(
                  eq(answer.userId, userId),
                  or(
                    inArray(
                      answer.fingerprint,
                      usable.map((f) => f.fingerprint),
                    ),
                    inArray(
                      answer.normalizedLabel,
                      usable.map((f) => f.normalizedLabel),
                    ),
                  ),
                ),
              )
      const byLabel = new Map(rows.map((row) => [row.normalizedLabel, row]))
      type Row = (typeof rows)[number]

      const toMatch = (fieldId: string, row: Row, source: "exact" | "label" | "similar", score: number) => {
        const f = fields.find((candidate) => candidate.field.id === fieldId)!
        const value = row.status === "rejected" || isSensitiveValue(row.value) ? null : usableValue(row, f.field)
        if (value === null) return null
        const autofill =
          source !== "similar" && value.length <= LEARNING_AUTOFILL_VALUE_MAX && row.timesCleared < CLEARED_STOP_MIN
        return {
          fieldId,
          answerId: row.id,
          value,
          source,
          autofill,
          score,
          timesUsed: row.timesUsed,
          timesCorrected: row.timesCorrected,
        }
      }

      type Match = NonNullable<ReturnType<typeof toMatch>> | NonNullable<ReturnType<typeof toSiteMatch>>
      const toSiteMatch = (f: (typeof usable)[number]) => {
        const entry = saved?.fieldMap[f.fieldKey]
        if (!saved || !entry) return null
        const global = byLabel.get(f.normalizedLabel)
        if (global?.status === "rejected") return null
        if (!entryIsFresh(entry, { answer: global, profileUpdatedAt })) return null
        const value = isSensitiveValue(entry.value)
          ? null
          : usableValue({ value: entry.value, fingerprint: f.fieldKey }, f.field)
        if (value === null) return null
        return {
          fieldId: f.field.id,
          answerId: entry.answerId,
          value,
          source: "site" as const,
          autofill: value.length <= LEARNING_AUTOFILL_VALUE_MAX && !stopsAutofill(entry),
          score: 1,
          timesUsed: entry.timesUsed,
          timesCorrected: entry.timesCorrected,
        }
      }

      const matches = new Map<string, Match>()
      const unmatched = []
      for (const f of usable) {
        const site = toSiteMatch(f)
        if (site) {
          matches.set(f.field.id, site)
          continue
        }
        const row = byLabel.get(f.normalizedLabel)
        if (!row) {
          unmatched.push(f)
          continue
        }
        const match = toMatch(f.field.id, row, row.fingerprint === f.fingerprint ? "exact" : "label", 1)
        if (match) matches.set(f.field.id, match)
      }

      if (unmatched.length > 0 && context.embeddingModel) {
        const [embedded] = await context.db
          .select({ id: answer.id })
          .from(answer)
          .where(and(eq(answer.userId, userId), isNotNull(answer.embedding), ne(answer.status, "rejected")))
          .limit(1)
        const texts = embedded ? [...new Set(unmatched.map((f) => embeddingText(f.normalizedLabel)))] : []
        const vectors =
          texts.length === 0
            ? null
            : await embedTexts({ model: context.embeddingModel, texts }).catch((error) => {
                logBestEffort("learning.lookup", "embeddings failed", error)
                return null
              })
        if (vectors) {
          const hits = await findSimilarAnswersMany(context.db, userId, vectors, NEIGHBOURS)
          const neighbours = hits.length
            ? new Map(
                (
                  await context.db
                    .select(answerColumns)
                    .from(answer)
                    .where(and(eq(answer.userId, userId), inArray(answer.id, [...new Set(hits.map((hit) => hit.id))])))
                ).map((row) => [row.id, row]),
              )
            : new Map<string, Row>()
          for (const f of unmatched) {
            const query = texts.indexOf(embeddingText(f.normalizedLabel))
            const ranked = hits
              .filter((hit) => hit.query === query)
              .flatMap((hit) => {
                const row = neighbours.get(hit.id)
                const match = row && toMatch(f.field.id, row, "similar", hit.score)
                return match ? [match] : []
              })
              .sort((a, b) => b.score - a.score)
            const [best, runnerUp] = ranked
            if (!best || best.score < SIMILARITY_MIN) continue
            if (runnerUp && best.score - runnerUp.score < SIMILARITY_MARGIN) continue
            matches.set(f.field.id, best)
          }
        }
      }

      return { matches: input.fields.map((f) => matches.get(f.id) ?? { fieldId: f.id, source: "none" as const }) }
    }),

  record: protectedProcedure
    .route({
      method: "POST",
      path: "/learning/record",
      summary: "Log what was filled against what the user left, and learn from the corrections",
      tags: ["learning"],
    })
    .input(recordInputSchema)
    .output(recordOutputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      if (input.applicationId) {
        const [owned] = await context.db
          .select({ id: application.id })
          .from(application)
          .where(mine(application, userId, input.applicationId))
        orNotFound(owned, "Application")
      }

      const flagged = await guardLearningDb("record", () => flaggedKeys(context.db, context.now(), input.events))
      const learnable = (event: (typeof input.events)[number]) =>
        isLearnableQuestion(event) && !flagged.has(verdictKey(event) ?? "")
      const events = input.events
        .filter(
          (event) => learnable(event) && !isSensitiveValue(event.filledValue) && !isSensitiveValue(event.finalValue),
        )
        .flatMap((event) => {
          const filled = event.filledValue.trim()
          const final = event.finalValue.trim()
          const outcome = outcomeOf(filled, final)
          const { normalizedLabel, fingerprint, fieldKey } = fingerprintOf(event)
          return outcome && normalizedLabel
            ? [{ event, filled, final, outcome, normalizedLabel, fingerprint, fieldKey }]
            : []
        })
        .sort((a, b) => (a.normalizedLabel < b.normalizedLabel ? -1 : a.normalizedLabel > b.normalizedLabel ? 1 : 0))
      const result = { recorded: events.length, skipped: input.events.length - events.length }
      if (events.length === 0) {
        return {
          ...result,
          siteProfile: { status: "skipped" as const, reason: "no_learnable_fields" as const },
          answers: { status: "saved" as const, skipped: 0 },
        }
      }
      // The form is every learnable field the batch reports, filled or not, so it matches what lookup sends. A client can't choose the signature.
      const formKeys = formFieldKeys(
        input.events.filter(learnable).flatMap((event) => {
          const { normalizedLabel, fieldKey } = fingerprintOf(event)
          return normalizedLabel ? [fieldKey] : []
        }),
      )

      const now = context.now()
      const learned = await guardLearningDb("record", () =>
        context.db.transaction(async (tx) => {
          if (input.batchId) {
            const hash = payloadHash([input.siteKey, input.applicationId ?? null, input.events])
            const [fresh] = await tx
              .insert(recordBatch)
              .values({ userId, batchId: input.batchId, payloadHash: hash })
              .onConflictDoNothing()
              .returning({ batchId: recordBatch.batchId })
            if (!fresh) {
              const [spent] = await tx
                .select({ payloadHash: recordBatch.payloadHash, response: recordBatch.response })
                .from(recordBatch)
                .where(and(eq(recordBatch.userId, userId), eq(recordBatch.batchId, input.batchId)))
              if (spent?.payloadHash !== hash) {
                throw new ORPCError("CONFLICT", { message: "That batch id was already used for different events." })
              }
              return {
                replay: spent.response ?? {
                  ...result,
                  siteProfile: { status: "saved" as const },
                  answers: { status: "saved" as const, skipped: 0 },
                },
                touched: [],
              }
            }
          }

          // New questions beyond the answer bank's cap are left out; their events, the updates to existing answers and the site profile still go in.
          const learnable = (e: (typeof events)[number]) =>
            e.outcome === "corrected" && e.final.length <= LEARNING_AUTOFILL_VALUE_MAX
          const full = await labelsWithoutRoom(
            tx,
            userId,
            events.filter(learnable).map((e) => e.normalizedLabel),
          )
          await tx.insert(fieldEvent).values(
            events.map((e) => ({
              userId,
              applicationId: input.applicationId ?? null,
              siteKey: input.siteKey,
              fingerprint: e.fingerprint,
              normalizedLabel: e.normalizedLabel,
              rawLabel: e.event.label,
              fieldType: (e.event.type ?? "").toLowerCase(),
              filledValue: e.filled,
              finalValue: e.final,
              source: e.event.source,
              outcome: e.outcome,
            })),
          )

          const touched: { id: string; normalizedLabel: string }[] = []
          let skippedAnswers = 0
          for (const e of events) {
            const sameValue = and(
              eq(answer.userId, userId),
              eq(answer.normalizedLabel, e.normalizedLabel),
              eq(answer.value, e.filled),
            )
            if (e.outcome === "accepted") {
              await tx
                .update(answer)
                .set({ timesUsed: sql`${answer.timesUsed} + 1`, timesCleared: 0, updatedAt: now })
                .where(sameValue)
            } else if (e.outcome === "cleared") {
              await tx
                .update(answer)
                .set({
                  timesUsed: sql`${answer.timesUsed} + 1`,
                  timesCorrected: sql`${answer.timesCorrected} + 1`,
                  timesCleared: sql`${answer.timesCleared} + 1`,
                  lastCorrectedAt: now,
                  updatedAt: now,
                })
                .where(sameValue)
            } else if (e.final.length > LEARNING_AUTOFILL_VALUE_MAX) {
              await tx
                .delete(answer)
                .where(
                  and(
                    eq(answer.userId, userId),
                    eq(answer.normalizedLabel, e.normalizedLabel),
                    eq(answer.status, "learned"),
                  ),
                )
            } else if (full.has(e.normalizedLabel)) {
              skippedAnswers++
            } else {
              const [row] = await tx
                .insert(answer)
                .values({
                  userId,
                  normalizedLabel: e.normalizedLabel,
                  rawLabel: e.event.label,
                  value: e.final,
                  source: "autofill",
                  timesCorrected: 1,
                  lastCorrectedAt: now,
                  fingerprint: e.fingerprint,
                })
                .onConflictDoUpdate({
                  target: [answer.userId, answer.normalizedLabel],
                  // An answer the user confirmed by hand keeps its value: the correction stays in the site profile.
                  setWhere: or(ne(answer.status, "confirmed"), eq(answer.value, e.final)),
                  set: {
                    rawLabel: e.event.label,
                    value: e.final,
                    source: "autofill",
                    fingerprint: e.fingerprint,
                    timesUsed: sql`${answer.timesUsed} + case when ${answer.value} = ${e.filled} then 1 else 0 end`,
                    timesCorrected: sql`${answer.timesCorrected} + 1`,
                    timesCleared: 0,
                    lastCorrectedAt: now,
                    updatedAt: now,
                  },
                })
                .returning({ id: answer.id })
              if (row) touched.push({ id: row.id, normalizedLabel: e.normalizedLabel })
            }
          }
          const siteProfileStatus = await saveSiteProfile(tx, userId, input.siteKey, formKeys, events, now)
          const response = {
            ...result,
            siteProfile: siteProfileStatus,
            answers: {
              status: skippedAnswers > 0 ? ("bank_full" as const) : ("saved" as const),
              skipped: skippedAnswers,
            },
          }
          if (input.batchId) {
            await tx
              .update(recordBatch)
              .set({ response })
              .where(and(eq(recordBatch.userId, userId), eq(recordBatch.batchId, input.batchId)))
          }
          return { replay: null, touched, response }
        }),
      )
      if (learned.replay) return learned.replay

      await embedMissing(context, "learning.record", userId, learned.touched)
      await purgeOld(context.db, userId, now)
      return learned.response
    }),

  siteProfiles: protectedProcedure
    .route({
      method: "GET",
      path: "/learning/sites",
      summary: "What was learned per site: the forms last filled, most recent first",
      tags: ["learning"],
    })
    .input(siteProfilesInputSchema)
    .output(siteProfilesOutputSchema)
    .handler(async ({ context, input }) => {
      const rows = await guardLearningDb("siteProfiles", () =>
        context.db
          .select()
          .from(siteProfile)
          .where(eq(siteProfile.userId, context.user.id))
          .orderBy(desc(siteProfile.lastUsedAt), desc(siteProfile.id))
          .limit(input.limit),
      )
      return rows.map((row) => ({
        id: row.id,
        siteKey: row.siteKey,
        timesUsed: row.timesUsed,
        lastUsedAt: row.lastUsedAt,
        fields: Object.entries(row.fieldMap).map(([fieldKey, entry]) => ({ fieldKey, ...entry })),
      }))
    }),

  forgetSite: protectedProcedure
    .route({
      method: "POST",
      path: "/learning/sites/forget",
      summary: "Forget the learned form maps of one site: saved answers and logged corrections stay",
      tags: ["learning"],
    })
    .input(forgetSiteInputSchema)
    .output(forgetSiteOutputSchema)
    .handler(async ({ context, input }) => {
      const removed = await guardLearningDb("forgetSite", () =>
        context.db.transaction((tx) =>
          withSiteLock(tx, context.user.id, () =>
            tx
              .delete(siteProfile)
              .where(and(eq(siteProfile.userId, context.user.id), eq(siteProfile.siteKey, input.siteKey)))
              .returning({ id: siteProfile.id }),
          ),
        ),
      )
      return { removedForms: removed.length }
    }),

  suggestions: protectedProcedure
    .route({
      method: "GET",
      path: "/learning/suggestions",
      summary: "Answers worth keeping, ones that keep changing or being cleared, and stale ones",
      tags: ["learning"],
    })
    .output(suggestionsOutputSchema)
    .handler(async ({ context }) => {
      const userId = context.user.id
      const now = context.now().getTime()
      const staleBefore = new Date(now - SUGGEST_STALE_DAYS * DAY_MS)
      const since = new Date(now - SUGGEST_WINDOW_DAYS * DAY_MS)

      const PER_KIND = 50
      const recent = and(
        eq(fieldEvent.userId, userId),
        eq(fieldEvent.outcome, "corrected"),
        gte(fieldEvent.createdAt, since),
      )
      const labelsWhere = (having: ReturnType<typeof sql>) =>
        context.db
          .select({ label: fieldEvent.normalizedLabel })
          .from(fieldEvent)
          .where(recent)
          .groupBy(fieldEvent.normalizedLabel)
          .having(having)
          .orderBy(desc(sql`max(${fieldEvent.createdAt})`))
          .limit(PER_KIND)
      const [flipLabels, keepLabels] = await Promise.all([
        labelsWhere(sql`count(*) >= ${SUGGEST_FLIP_FLOP_MIN} and count(distinct ${fieldEvent.finalValue}) > 1`),
        labelsWhere(sql`count(*) >= ${SUGGEST_KEEP_MIN} and count(distinct ${fieldEvent.finalValue}) = 1`),
      ])
      const learnedLabels = [...new Set([...flipLabels, ...keepLabels].map((row) => row.label))]
      const open = and(eq(answer.userId, userId), ne(answer.status, "rejected"))
      const [learned, clearing, stale] = await Promise.all([
        learnedLabels.length === 0
          ? []
          : context.db
              .select(answerColumns)
              .from(answer)
              .where(and(open, eq(answer.status, "learned"), inArray(answer.normalizedLabel, learnedLabels))),
        context.db
          .select(answerColumns)
          .from(answer)
          .where(and(open, sql`${answer.timesCleared} >= ${CLEARED_STOP_MIN}`))
          .orderBy(answer.normalizedLabel)
          .limit(PER_KIND),
        context.db
          .select(answerColumns)
          .from(answer)
          .where(and(open, lt(answer.updatedAt, staleBefore)))
          .orderBy(answer.normalizedLabel)
          .limit(PER_KIND),
      ])
      const candidates = [...new Map([...learned, ...clearing, ...stale].map((row) => [row.id, row])).values()]
      await purgeOld(context.db, userId, context.now())
      if (candidates.length === 0) return []

      const events = await context.db
        .select({ normalizedLabel: fieldEvent.normalizedLabel, finalValue: fieldEvent.finalValue })
        .from(fieldEvent)
        .where(
          and(
            eq(fieldEvent.userId, userId),
            eq(fieldEvent.outcome, "corrected"),
            gte(fieldEvent.createdAt, since),
            inArray(
              fieldEvent.normalizedLabel,
              candidates.map((a) => a.normalizedLabel),
            ),
          ),
        )
        .orderBy(desc(fieldEvent.createdAt), desc(fieldEvent.id))
        .limit(SUGGESTION_EVENTS_MAX)

      const order = { flip_flop: 0, keep: 1, cleared: 2, stale: 3 }
      const suggestions: { kind: keyof typeof order; answer: (typeof candidates)[number]; count: number }[] = []
      for (const row of candidates) {
        const finals = events.filter((e) => e.normalizedLabel === row.normalizedLabel).map((e) => e.finalValue)
        const distinct = new Set(finals).size
        const lastRun = finals.slice(0, SUGGEST_STABLE_RUN)
        const settled = lastRun.length === SUGGEST_STABLE_RUN && new Set(lastRun).size === 1
        if (row.status === "learned" && finals.length >= SUGGEST_FLIP_FLOP_MIN && distinct > 1 && !settled) {
          suggestions.push({ kind: "flip_flop", answer: row, count: finals.length })
        } else if (
          row.status === "learned" &&
          finals.length >= SUGGEST_KEEP_MIN &&
          finals.every((v) => v === row.value)
        ) {
          suggestions.push({ kind: "keep", answer: row, count: finals.length })
        } else if (row.timesCleared >= CLEARED_STOP_MIN) {
          suggestions.push({ kind: "cleared", answer: row, count: row.timesCleared })
        } else if (row.updatedAt < staleBefore) {
          suggestions.push({ kind: "stale", answer: row, count: 0 })
        }
      }
      return suggestions.sort((a, b) => order[a.kind] - order[b.kind] || b.count - a.count)
    }),

  resolveSuggestion: protectedProcedure
    .route({
      method: "POST",
      path: "/learning/suggestions/{answerId}",
      summary: "Keep a learned answer as the default, or stop filling it and ask each time",
      tags: ["learning"],
    })
    .input(resolveSuggestionInputSchema)
    .output(answerSchema)
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .update(answer)
        .set(
          input.decision === "keep"
            ? { status: "confirmed", timesCleared: 0, updatedAt: context.now() }
            : { status: "rejected", updatedAt: context.now() },
        )
        .where(mine(answer, context.user.id, input.answerId))
        .returning(answerColumns)
      return orNotFound(row, "Answer")
    }),

  stats: protectedProcedure
    .route({
      method: "GET",
      path: "/learning/stats",
      summary: "Corrections per application, oldest first: the learning metric",
      tags: ["learning"],
    })
    .input(statsInputSchema)
    .output(statsOutputSchema)
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select({
          applicationId: application.id,
          appliedAt: application.appliedAt,
          fields: sql<number>`count(${fieldEvent.id})::int`,
          corrections: sql<number>`(count(${fieldEvent.id}) filter (where ${fieldEvent.outcome} <> 'accepted'))::int`,
        })
        .from(application)
        .innerJoin(fieldEvent, eq(fieldEvent.applicationId, application.id))
        .where(and(eq(application.userId, context.user.id), eq(fieldEvent.userId, context.user.id)))
        .groupBy(application.id, application.appliedAt)
        .orderBy(desc(application.appliedAt), desc(application.id))
        .limit(input.limit)
      return {
        applications: rows.reverse().map((row) => ({ ...row, correctionsPerField: row.corrections / row.fields })),
      }
    }),
}
