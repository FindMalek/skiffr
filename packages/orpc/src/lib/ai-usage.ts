import { ORPCError } from "@orpc/server"
import { AI_BUDGET_EXHAUSTED } from "@skiffr/common/constants"
import type { AiUsage } from "@skiffr/common/schemas"
import { aiUsage, type Db } from "@skiffr/db"
import { type LanguageModel, wrapLanguageModel } from "ai"
import { and, eq, sql } from "drizzle-orm"
import { safeErrorFields } from "./errors"

/** What one user may spend per UTC day. 0 is no limit. */
export interface AiBudget {
  dailyCalls: number
  dailyTokens: number
}

const UNLIMITED: AiBudget = { dailyCalls: 0, dailyTokens: 0 }
const CHARS_PER_TOKEN = 4
const DAY_MS = 24 * 60 * 60 * 1000

export interface AiUsageContext {
  db: Db
  now: () => Date
  aiBudget?: AiBudget | null
  user: { id: string }
}

export const utcDay = (at: Date): string => at.toISOString().slice(0, 10)

const secondsToMidnight = (at: Date): number => Math.max(1, Math.ceil((DAY_MS - (at.getTime() % DAY_MS)) / 1000))

/** The estimate used when a provider reports no usage. */
const estimateTokens = (payload: unknown): number => Math.ceil(JSON.stringify(payload ?? "").length / CHARS_PER_TOKEN)

/** One statement: the row is created or bumped only while it is under both limits, so parallel calls and replicas can't all slip through a stale read. Tokens are only known after a call, so the token limit is checked against what earlier calls spent. */
async function reserve(db: Db, budget: AiBudget, userId: string, day: string): Promise<boolean> {
  const under = [
    budget.dailyCalls > 0 ? sql`${aiUsage.calls} < ${budget.dailyCalls}` : undefined,
    budget.dailyTokens > 0 ? sql`${aiUsage.inputTokens} + ${aiUsage.outputTokens} < ${budget.dailyTokens}` : undefined,
  ].filter((condition) => condition !== undefined)
  const rows = await db
    .insert(aiUsage)
    .values({ userId, day, calls: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day],
      set: { calls: sql`${aiUsage.calls} + 1` },
      setWhere: under.length > 0 ? and(...under) : undefined,
    })
    .returning({ calls: aiUsage.calls })
  return rows.length > 0
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

/** A request that finds the budget spent sets `spent` and fails before anything is sent. */
function metered(model: Exclude<LanguageModel, string>, context: AiUsageContext, spent: { value: boolean }) {
  const budget = context.aiBudget ?? UNLIMITED
  return wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: async ({ doGenerate, params }) => {
        const day = utcDay(context.now())
        if (!(await reserve(context.db, budget, context.user.id, day))) {
          spent.value = true
          throw new Error("daily ai budget spent")
        }
        const result = await doGenerate()
        const input = result.usage.inputTokens.total ?? estimateTokens(params.prompt)
        const output = result.usage.outputTokens.total ?? estimateTokens(result.content)
        await addTokens(context.db, context.user.id, day, input, output).catch((error) =>
          console.error("[ai-usage] could not add tokens", safeErrorFields(error)),
        )
        return result
      },
    },
  })
}

/**
 * Runs `run` with `model` wrapped so that every request to the provider first takes a slot of the user's daily budget
 * (nothing is sent once it is spent) and afterwards adds the tokens the provider reports, or a guess from the payload
 * size when it reports none. It counts requests, so a retry after a provider error uses a slot too. A spent budget
 * surfaces as `AI_BUDGET_EXHAUSTED` (429), whatever the AI package made of the error on its way up.
 */
export async function withAiBudget<T>(
  context: AiUsageContext,
  model: LanguageModel,
  run: (model: LanguageModel) => Promise<T>,
): Promise<T> {
  if (typeof model === "string") throw new Error("A metered model must be a model object, not an id.")
  const spent = { value: false }
  try {
    return await run(metered(model, context, spent))
  } catch (error) {
    if (!spent.value) throw error
    throw new ORPCError(AI_BUDGET_EXHAUSTED, {
      status: 429,
      message: "The daily AI limit is used up. It resets at midnight UTC.",
      data: { retryAfterSeconds: secondsToMidnight(context.now()) },
    })
  }
}
