import { createHash } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { AiModelError, type ControlKind, controlKind, embedTexts } from "@skiffr/ai"
import { ANSWERS_PER_USER_MAX, EMBEDDING_TEXT_MAX } from "@skiffr/common/constants"
import { normalizeLabel } from "@skiffr/common/utils"
import { answer, type Db } from "@skiffr/db"
import type { EmbeddingModel } from "ai"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { describeError, safeErrorFields } from "./errors"

/** What identifies a field across forms: its normalized label, its control kind and the set of options it offers. */
export function fingerprintOf(field: { label: string; type?: string; options?: string[] }): {
  normalizedLabel: string
  fingerprint: string
} {
  const normalizedLabel = normalizeLabel(field.label)
  const options = [...new Set((field.options ?? []).map(normalizeLabel))].sort()
  const optionsHash =
    options.length > 0 ? createHash("sha256").update(options.join("\n")).digest("hex").slice(0, 16) : ""
  const type = (field.type ?? "").trim().toLowerCase()
  return { normalizedLabel, fingerprint: `${normalizedLabel}|${type}|${optionsHash}` }
}

/** The question text that gets embedded and matched. */
export const embeddingText = (normalizedLabel: string) => normalizedLabel.slice(0, EMBEDDING_TEXT_MAX)

const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase()

/** The option the value stands for: the same text first, then the same words, but only when no other option reads the same. */
function pickOption(value: string, options: string[]): string | null {
  const wanted = plain(value)
  if (!wanted) return null
  const exact = options.find((option) => plain(option) === wanted)
  if (exact !== undefined) return exact
  const words = normalizeLabel(value)
  if (!words) return null
  const loose = options.filter((option) => normalizeLabel(option) === words)
  return loose.length === 1 ? loose[0]! : null
}

/** Whether free text can go into a typed control: "five years" can't go into a number field. */
const FITS: Partial<Record<ControlKind, RegExp>> = {
  number: /^-?\d+(?:[.,]\d+)?$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  tel: /^\+?[\d\s().-]{5,}$/,
  url: /^https?:\/\/\S+$/i,
}

/**
 * The value to offer for this field, or `null` when it doesn't fit. The learned control must be the same kind, with
 * three exceptions: text (and manual answers, which have no control) can serve a typed control when the value looks
 * right for it, text can serve a choice when it is one of the options, and a typed answer can serve a text field. A
 * choice never fills free text. When the field lists options the value must be one of them and comes back as the
 * option's own text, which is what the page can select.
 */
export function usableValue(
  learned: { value: string; fingerprint: string | null },
  field: { type?: string; options: string[] },
): string | null {
  const fieldKind = controlKind(field.type)
  if (!fieldKind) return null
  const learnedKind = (learned.fingerprint ? controlKind(learned.fingerprint.split("|")[1]) : "text") ?? "text"
  if (learnedKind !== fieldKind) {
    const typedToText = fieldKind === "text" && learnedKind !== "choice" && learnedKind !== "checkbox"
    const textToChoice = learnedKind === "text" && fieldKind === "choice"
    const textToTyped = learnedKind === "text" && FITS[fieldKind]?.test(learned.value.trim())
    if (!typedToText && !textToChoice && !textToTyped) return null
  }
  if (field.options.length > 0) return pickOption(learned.value, field.options)
  return fieldKind === "choice" && learnedKind !== "choice" ? null : learned.value
}

/**
 * The only error that leaves a learning write. Drizzle's own errors carry the whole statement with its params (the
 * user's labels and values), so nothing from them is kept except the operation, the postgres code and the class.
 */
export class LearningStoreError extends Error {
  override name = "LearningStoreError"
  constructor(
    readonly operation: string,
    readonly code?: string,
    readonly causeName?: string,
  ) {
    super("The learning store failed.")
  }
}

export async function guardLearningDb<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ORPCError) throw error
    const { code, causeName } = describeError(error)
    throw new LearningStoreError(operation, code, causeName)
  }
}

/** Failures of work that is allowed to fail are logged as a class, never with the request: model errors add kind, status and request id. */
export function logBestEffort(route: string, what: string, error: unknown): void {
  const fields: Record<string, unknown> = safeErrorFields(error)
  if (error instanceof AiModelError) {
    Object.assign(fields, {
      kind: error.kind,
      status: error.status,
      modelId: error.modelId,
      requestId: error.requestId,
    })
  }
  console.error(`[${route}] ${what}`, fields)
}

/** Stores the question embedding of answers that have none. Best effort: nothing in here may fail the request that already succeeded. */
export async function embedMissing(
  context: { db: Db; embeddingModel?: EmbeddingModel | null },
  route: string,
  userId: string,
  items: { id: string; normalizedLabel: string }[],
): Promise<void> {
  const model = context.embeddingModel
  if (!model || items.length === 0) return
  try {
    const missing = new Set(
      (
        await context.db
          .select({ id: answer.id })
          .from(answer)
          .where(
            and(
              eq(answer.userId, userId),
              isNull(answer.embedding),
              inArray(
                answer.id,
                items.map((item) => item.id),
              ),
            ),
          )
      ).map((row) => row.id),
    )
    const todo = items.filter((item) => missing.has(item.id))
    if (todo.length === 0) return
    const vectors = await embedTexts({ model, texts: todo.map((item) => embeddingText(item.normalizedLabel)) })
    await Promise.all(
      todo.map((item, i) =>
        context.db
          .update(answer)
          .set({ embedding: vectors[i]! })
          .where(and(eq(answer.userId, userId), eq(answer.id, item.id))),
      ),
    )
  } catch (error) {
    logBestEffort(route, "embedding failed", error)
  }
}

/** A user's answer bank is capped. Updating a label that already exists is always fine. Call it inside the transaction that writes: it takes a per-user lock so parallel writes can't all squeeze under the cap. */
export async function assertAnswerRoom(
  db: Pick<Db, "select" | "execute">,
  userId: string,
  labels: string[],
): Promise<void> {
  const unique = [...new Set(labels)]
  if (unique.length === 0) return
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`answers:${userId}`}))`)
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(answer).where(eq(answer.userId, userId))
  if ((row?.count ?? 0) + unique.length <= ANSWERS_PER_USER_MAX) return
  const existing = await db
    .select({ label: answer.normalizedLabel })
    .from(answer)
    .where(and(eq(answer.userId, userId), inArray(answer.normalizedLabel, unique)))
  if ((row?.count ?? 0) + unique.length - existing.length > ANSWERS_PER_USER_MAX) {
    throw new ORPCError("BAD_REQUEST", { message: `You can save up to ${ANSWERS_PER_USER_MAX} answers.` })
  }
}

/** Same events, same hash: the key of a retried batch. */
export const payloadHash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex")
