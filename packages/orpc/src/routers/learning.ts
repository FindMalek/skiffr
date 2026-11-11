import { embedTexts, isLearnableField } from "@skiffr/ai"
import {
  CLEARED_STOP_MIN,
  FIELD_EVENT_PURGE_BATCH,
  FIELD_EVENT_RETENTION_DAYS,
  LEARNING_AUTOFILL_VALUE_MAX,
  SIMILARITY_MARGIN,
  SIMILARITY_MIN,
  SUGGEST_FLIP_FLOP_MIN,
  SUGGEST_KEEP_MIN,
  SUGGEST_STABLE_RUN,
  SUGGEST_STALE_DAYS,
  SUGGEST_WINDOW_DAYS,
} from "@skiffr/common/constants"
import {
  answerSchema,
  lookupInputSchema,
  lookupOutputSchema,
  recordInputSchema,
  recordOutputSchema,
  resolveSuggestionInputSchema,
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
  recordBatch,
} from "@skiffr/db"
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm"
import {
  assertAnswerRoom,
  embeddingText,
  embedMissing,
  fingerprintOf,
  guardLearningDb,
  logBestEffort,
  usableValue,
} from "../lib/learning"
import { mine, orNotFound } from "../lib/owned"
import { protectedProcedure } from "../procedures"

const DAY_MS = 86_400_000
const SUGGESTIONS_MAX = 100
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
  } catch (error) {
    logBestEffort("learning.record", "purge failed", error)
  }
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
      const fields = input.fields.map((field) => ({
        field,
        ...fingerprintOf(field),
        learnable: isLearnableField(field),
      }))
      const usable = fields.filter((f) => f.learnable)
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
        const value = row.status === "rejected" ? null : usableValue(row, f.field)
        if (value === null) return null
        const autofill =
          source !== "similar" &&
          value.length <= LEARNING_AUTOFILL_VALUE_MAX &&
          (row.status === "confirmed" || row.timesCleared < CLEARED_STOP_MIN)
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

      const matches = new Map<string, NonNullable<ReturnType<typeof toMatch>>>()
      const unmatched = []
      for (const f of usable) {
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

      const events = input.events
        .filter((event) => isLearnableField(event))
        .flatMap((event) => {
          const filled = event.filledValue.trim()
          const final = event.finalValue.trim()
          const outcome = outcomeOf(filled, final)
          const { normalizedLabel, fingerprint } = fingerprintOf(event)
          return outcome && normalizedLabel ? [{ event, filled, final, outcome, normalizedLabel, fingerprint }] : []
        })
        .sort((a, b) => (a.normalizedLabel < b.normalizedLabel ? -1 : a.normalizedLabel > b.normalizedLabel ? 1 : 0))
      const result = { recorded: events.length, skipped: input.events.length - events.length }
      if (events.length === 0) return result

      const now = context.now()
      const learned = await guardLearningDb("record", () =>
        context.db.transaction(async (tx) => {
          if (input.batchId) {
            const [fresh] = await tx
              .insert(recordBatch)
              .values({ userId, batchId: input.batchId })
              .onConflictDoNothing()
              .returning({ batchId: recordBatch.batchId })
            if (!fresh) return null
          }

          const learnable = (e: (typeof events)[number]) =>
            e.outcome === "corrected" && e.final.length <= LEARNING_AUTOFILL_VALUE_MAX
          await assertAnswerRoom(
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
            } else if (learnable(e)) {
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
                  set: {
                    rawLabel: e.event.label,
                    value: e.final,
                    source: "autofill",
                    fingerprint: e.fingerprint,
                    timesUsed: sql`${answer.timesUsed} + case when ${answer.value} = ${e.filled} then 1 else 0 end`,
                    timesCorrected: sql`${answer.timesCorrected} + 1`,
                    timesCleared: 0,
                    status: sql`case when ${answer.value} = ${e.final} then ${answer.status} when ${answer.status} = 'confirmed' then 'learned' else ${answer.status} end`,
                    lastCorrectedAt: now,
                    updatedAt: now,
                  },
                })
                .returning({ id: answer.id })
              if (row) touched.push({ id: row.id, normalizedLabel: e.normalizedLabel })
            }
          }
          return touched
        }),
      )
      if (learned === null) return result

      await embedMissing(context, "learning.record", userId, learned)
      await purgeOld(context.db, userId, now)
      return result
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

      const corrected = and(eq(answer.status, "learned"), sql`${answer.timesCorrected} >= ${SUGGEST_KEEP_MIN}`)
      const cleared = sql`${answer.timesCleared} >= ${CLEARED_STOP_MIN}`
      const candidates = await context.db
        .select(answerColumns)
        .from(answer)
        .where(
          and(
            eq(answer.userId, userId),
            ne(answer.status, "rejected"),
            or(corrected, cleared, lt(answer.updatedAt, staleBefore)),
          ),
        )
        .orderBy(sql`case when ${corrected} then 0 when ${cleared} then 1 else 2 end`, answer.normalizedLabel)
        .limit(SUGGESTIONS_MAX)
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
