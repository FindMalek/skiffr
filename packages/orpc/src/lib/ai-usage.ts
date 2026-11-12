import { ORPCError } from "@orpc/server"
import { AiModelError, ModelBudgetError } from "@skiffr/ai"
import { AI_BUDGET_EXHAUSTED } from "@skiffr/common/constants"
import type { AiUsage } from "@skiffr/common/schemas"
import { aiUsage, aiUsageGlobal, type Db } from "@skiffr/db"
import { type EmbeddingModel, type LanguageModel, wrapEmbeddingModel, wrapLanguageModel } from "ai"
import { and, eq, sql } from "drizzle-orm"
import { safeErrorFields } from "./errors"

/** What one user may spend per UTC day, and what the whole server may. 0 is no limit. */
export interface AiBudget {
  dailyCalls: number
  dailyTokens: number
  globalDailyCalls?: number
}

export interface AiModels {
  model: LanguageModel | null
  embeddingModel: EmbeddingModel | null
}

const UNLIMITED: AiBudget = { dailyCalls: 0, dailyTokens: 0, globalDailyCalls: 0 }
const CHARS_PER_TOKEN = 4
const DAY_MS = 24 * 60 * 60 * 1000
const INT_MAX = 2_147_483_647

export interface AiUsageContext {
  db: Db
  now: () => Date
  aiBudget?: AiBudget | null
  user: { id: string }
}

export const utcDay = (at: Date): string => at.toISOString().slice(0, 10)

const secondsToMidnight = (at: Date): number => Math.max(1, Math.ceil((DAY_MS - (at.getTime() % DAY_MS)) / 1000))

/** What a provider reports is not trusted: a negative or broken count must never refund the budget. */
function tokenCount(reported: number | undefined, payload: unknown): number {
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0)
    return Math.min(INT_MAX, Math.trunc(reported))
  return Math.min(INT_MAX, Math.ceil(JSON.stringify(payload ?? "").length / CHARS_PER_TOKEN))
}

class Refused extends Error {}

/**
 * One statement per counter: a row is created or bumped only while it is under its limit, so parallel calls and replicas
 * can't all slip through a stale read. With a server cap both counters move in one transaction (the server's first, always
 * in that order), so a refused user does not use up a slot of everyone else. Tokens are only known after a call, so the
 * token limit is checked against what earlier calls spent.
 */
async function reserve(db: Db, budget: AiBudget, userId: string, day: string): Promise<boolean> {
  const under = [
    budget.dailyCalls > 0 ? sql`${aiUsage.calls} < ${budget.dailyCalls}` : undefined,
    budget.dailyTokens > 0 ? sql`${aiUsage.inputTokens} + ${aiUsage.outputTokens} < ${budget.dailyTokens}` : undefined,
  ].filter((condition) => condition !== undefined)
  const takeUser = async (tx: Pick<Db, "insert">) =>
    (
      await tx
        .insert(aiUsage)
        .values({ userId, day, calls: 1 })
        .onConflictDoUpdate({
          target: [aiUsage.userId, aiUsage.day],
          set: { calls: sql`${aiUsage.calls} + 1` },
          setWhere: under.length > 0 ? and(...under) : undefined,
        })
        .returning({ calls: aiUsage.calls })
    ).length > 0
  const cap = budget.globalDailyCalls ?? 0
  if (cap <= 0) return takeUser(db)
  try {
    return await db.transaction(async (tx) => {
      const taken = await tx
        .insert(aiUsageGlobal)
        .values({ day, calls: 1 })
        .onConflictDoUpdate({
          target: aiUsageGlobal.day,
          set: { calls: sql`${aiUsageGlobal.calls} + 1` },
          setWhere: sql`${aiUsageGlobal.calls} < ${cap}`,
        })
        .returning({ calls: aiUsageGlobal.calls })
      if (taken.length === 0 || !(await takeUser(tx))) throw new Refused()
      return true
    })
  } catch (error) {
    if (error instanceof Refused) return false
    throw error
  }
}

async function addTokens(db: Db, userId: string, day: string, input: number, output: number): Promise<void> {
  await db
    .update(aiUsage)
    .set({
      inputTokens: sql`${aiUsage.inputTokens} + ${input}`,
      outputTokens: sql`${aiUsage.outputTokens} + ${output}`,
    })
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, day)))
}

export async function aiUsageToday(context: AiUsageContext): Promise<AiUsage> {
  const day = utcDay(context.now())
  const [row] = await context.db
    .select()
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, context.user.id), eq(aiUsage.day, day)))
  const budget = context.aiBudget ?? UNLIMITED
  return {
    day,
    calls: row?.calls ?? 0,
    tokens: (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0),
    limits: { calls: budget.dailyCalls, tokens: budget.dailyTokens },
  }
}

/** Takes a slot of the budget before a request leaves for the provider, and gives the tokens back to count once it is answered. */
function meter(context: AiUsageContext) {
  const budget = context.aiBudget ?? UNLIMITED
  return async () => {
    const day = utcDay(context.now())
    if (!(await reserve(context.db, budget, context.user.id, day))) throw new ModelBudgetError()
    return (input: number, output: number) =>
      addTokens(context.db, context.user.id, day, input, output).catch((error) =>
        console.error("[ai-usage] could not add tokens", safeErrorFields(error)),
      )
  }
}

/**
 * The only way a procedure gets a model: every request to the provider (chat and embeddings alike) first takes a slot of
 * the user's daily budget, nothing is sent once it is spent, and afterwards the tokens the provider reports (or a guess
 * from the payload size) are added. It counts requests, so a retry after a provider error uses a slot too. Streaming is
 * not metered, so it is refused. `protectedProcedure` swaps these in, so a new call site can't forget.
 */
export function budgetedModels(context: AiUsageContext, models: AiModels): AiModels {
  const slot = meter(context)
  const { model, embeddingModel } = models
  if (typeof model === "string" || typeof embeddingModel === "string") {
    throw new Error("A metered model must be a model object, not an id.")
  }
  return {
    model: model
      ? wrapLanguageModel({
          model,
          middleware: {
            wrapGenerate: async ({ doGenerate, params }) => {
              const record = await slot()
              const result = await doGenerate()
              await record(
                tokenCount(result.usage.inputTokens.total, params.prompt),
                tokenCount(result.usage.outputTokens.total, result.content),
              )
              return result
            },
            wrapStream: async () => {
              throw new Error("Streaming is not metered.")
            },
          },
        })
      : null,
    embeddingModel: embeddingModel
      ? wrapEmbeddingModel({
          model: embeddingModel as Parameters<typeof wrapEmbeddingModel>[0]["model"],
          middleware: {
            wrapEmbed: async ({ doEmbed, params }) => {
              const record = await slot()
              const result = await doEmbed()
              await record(tokenCount(result.usage?.tokens, params.values), 0)
              return result
            },
          },
        })
      : null,
  }
}

/** A request found the budget spent, whether the error came raw or through the AI package. */
export const isBudgetSpent = (error: unknown): boolean =>
  error instanceof ModelBudgetError || (error instanceof AiModelError && error.kind === "budget")

export function budgetExhausted(now: Date): ORPCError<string, { retryAfterSeconds: number }> {
  return new ORPCError(AI_BUDGET_EXHAUSTED, {
    status: 429,
    message: "The daily AI limit is used up. It resets at midnight UTC.",
    data: { retryAfterSeconds: secondsToMidnight(now) },
  })
}
