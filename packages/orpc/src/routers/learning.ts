import { embedTexts, isLearnableField } from "@skiffr/ai"
import {
  SIMILARITY_MARGIN,
  SIMILARITY_MIN,
  SUGGEST_FLIP_FLOP_MIN,
  SUGGEST_KEEP_MIN,
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
import { answer, answerColumns, application, fieldEvent, findSimilarAnswers } from "@skiffr/db"
import { and, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm"
import { embeddingText, fingerprintOf, logEmbeddingFailure } from "../lib/learning"
import { mine, orNotFound } from "../lib/owned"
import { protectedProcedure } from "../procedures"

const DAY_MS = 86_400_000
const SUGGESTIONS_MAX = 100

type Outcome = "accepted" | "corrected" | "cleared"

function outcomeOf(filled: string, final: string): Outcome | null {
  if (!filled && !final) return null
  if (!final) return "cleared"
  return final === filled ? "accepted" : "corrected"
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
        learnable: isLearnableField({ label: field.label, type: field.type }),
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

      const matches = new Map<string, NonNullable<ReturnType<typeof toMatch>>>()
      const toMatch = (
        fieldId: string,
        row: (typeof rows)[number],
        source: "exact" | "label" | "similar",
        score: number,
      ) =>
        row.status === "rejected"
          ? null
          : {
              fieldId,
              answerId: row.id,
              value: row.value,
              source,
              score,
              timesUsed: row.timesUsed,
              timesCorrected: row.timesCorrected,
            }

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
        const texts = [...new Set(unmatched.map((f) => embeddingText(f.normalizedLabel)))]
        const vectors = await embedTexts({ model: context.embeddingModel, texts }).catch((error) => {
          logEmbeddingFailure("learning.lookup", error)
          return null
        })
        if (vectors) {
          const vectorOf = new Map(texts.map((text, i) => [text, vectors[i]!]))
          await Promise.all(
            unmatched.map(async (f) => {
              const [best, runnerUp] = await findSimilarAnswers(
                context.db,
                userId,
                vectorOf.get(embeddingText(f.normalizedLabel))!,
                2,
              )
              if (!best) return
              const score = 1 - best.distance
              if (score < SIMILARITY_MIN) return
              if (runnerUp && score - (1 - runnerUp.distance) < SIMILARITY_MARGIN) return
              const match = toMatch(f.field.id, best, "similar", score)
              if (match) matches.set(f.field.id, match)
            }),
          )
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
        .filter((event) => isLearnableField({ label: event.label, type: event.type }))
        .flatMap((event) => {
          const filled = event.filledValue.trim()
          const final = event.finalValue.trim()
          const outcome = outcomeOf(filled, final)
          const { normalizedLabel, fingerprint } = fingerprintOf(event)
          return outcome && normalizedLabel ? [{ event, filled, final, outcome, normalizedLabel, fingerprint }] : []
        })
        .sort((a, b) => (a.normalizedLabel < b.normalizedLabel ? -1 : a.normalizedLabel > b.normalizedLabel ? 1 : 0))
      if (events.length === 0) return { recorded: 0, skipped: input.events.length }

      const now = context.now()
      const toEmbed = await context.db.transaction(async (tx) => {
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

        const pending = new Map<string, string>()
        for (const e of events) {
          const sameValue = and(
            eq(answer.userId, userId),
            eq(answer.normalizedLabel, e.normalizedLabel),
            eq(answer.value, e.filled),
          )
          if (e.outcome === "accepted") {
            await tx
              .update(answer)
              .set({ timesUsed: sql`${answer.timesUsed} + 1`, updatedAt: now })
              .where(sameValue)
          } else if (e.outcome === "cleared") {
            await tx
              .update(answer)
              .set({
                timesUsed: sql`${answer.timesUsed} + 1`,
                timesCorrected: sql`${answer.timesCorrected} + 1`,
                lastCorrectedAt: now,
                updatedAt: now,
              })
              .where(sameValue)
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
                set: {
                  rawLabel: e.event.label,
                  value: e.final,
                  source: "autofill",
                  fingerprint: e.fingerprint,
                  timesUsed: sql`${answer.timesUsed} + case when ${answer.value} = ${e.filled} then 1 else 0 end`,
                  timesCorrected: sql`${answer.timesCorrected} + 1`,
                  status: sql`case when ${answer.value} = ${e.final} then ${answer.status} when ${answer.status} = 'confirmed' then 'learned' else ${answer.status} end`,
                  lastCorrectedAt: now,
                  updatedAt: now,
                },
              })
              .returning({ id: answer.id, embedded: sql<boolean>`${answer.embedding} is not null` })
            if (row && !row.embedded) pending.set(row.id, e.normalizedLabel)
          }
        }
        return pending
      })

      if (toEmbed.size > 0 && context.embeddingModel) {
        const ids = [...toEmbed.keys()]
        try {
          const vectors = await embedTexts({
            model: context.embeddingModel,
            texts: ids.map((id) => embeddingText(toEmbed.get(id)!)),
          })
          await Promise.all(
            ids.map((id, i) =>
              context.db
                .update(answer)
                .set({ embedding: vectors[i]! })
                .where(mine(answer, userId, id)),
            ),
          )
        } catch (error) {
          logEmbeddingFailure("learning.record", error)
        }
      }

      return { recorded: events.length, skipped: input.events.length - events.length }
    }),

  suggestions: protectedProcedure
    .route({
      method: "GET",
      path: "/learning/suggestions",
      summary: "Answers worth keeping, answers that keep changing, and stale ones",
      tags: ["learning"],
    })
    .output(suggestionsOutputSchema)
    .handler(async ({ context }) => {
      const userId = context.user.id
      const now = context.now().getTime()
      const staleBefore = new Date(now - SUGGEST_STALE_DAYS * DAY_MS)
      const since = new Date(now - SUGGEST_WINDOW_DAYS * DAY_MS)

      const candidates = await context.db
        .select(answerColumns)
        .from(answer)
        .where(
          and(
            eq(answer.userId, userId),
            ne(answer.status, "rejected"),
            or(
              and(eq(answer.status, "learned"), gte(answer.timesCorrected, SUGGEST_KEEP_MIN)),
              lt(answer.updatedAt, staleBefore),
            ),
          ),
        )
        .orderBy(answer.normalizedLabel)
        .limit(SUGGESTIONS_MAX)
      if (candidates.length === 0) return []

      const corrections = await context.db
        .select({
          normalizedLabel: fieldEvent.normalizedLabel,
          finalValue: fieldEvent.finalValue,
          count: sql<number>`count(*)::int`,
        })
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
        .groupBy(fieldEvent.normalizedLabel, fieldEvent.finalValue)

      const order = { flip_flop: 0, keep: 1, stale: 2 }
      const suggestions: { kind: keyof typeof order; answer: (typeof candidates)[number]; count: number }[] = []
      for (const row of candidates) {
        const own = corrections.filter((c) => c.normalizedLabel === row.normalizedLabel)
        const identical = own.find((c) => c.finalValue === row.value)?.count ?? 0
        if (row.status === "learned" && own.length >= SUGGEST_FLIP_FLOP_MIN) {
          suggestions.push({ kind: "flip_flop", answer: row, count: own.length })
        } else if (row.status === "learned" && identical >= SUGGEST_KEEP_MIN) {
          suggestions.push({ kind: "keep", answer: row, count: identical })
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
        .set({ status: input.decision === "keep" ? "confirmed" : "rejected", updatedAt: context.now() })
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
      return { applications: rows.reverse() }
    }),
}
