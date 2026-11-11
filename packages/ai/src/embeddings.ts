import { createOpenAI } from "@ai-sdk/openai"
import { EMBEDDING_DIMENSIONS, EMBEDDING_TEXT_MAX, EMBEDDING_TEXTS_MAX } from "@skiffr/common/constants"
import { type EmbeddingModel, embedMany } from "ai"
import { AiInputError, AiModelError, toAiError } from "./errors"

export const EMBEDDING_MODEL_ID = "text-embedding-3-small"
const TIMEOUT_MS = 10_000

/** Null without a key, so features that need embeddings skip them instead of failing. */
export function resolveEmbeddingModel(keys: { OPENAI_API_KEY?: string }): EmbeddingModel | null {
  return keys.OPENAI_API_KEY ? createOpenAI({ apiKey: keys.OPENAI_API_KEY }).embedding(EMBEDDING_MODEL_ID) : null
}

/**
 * One vector per text, in order. Meant for the normalized question of an answer, never for the user's value. Too many or
 * too long texts are refused before any call, and provider failures leave as `AiModelError` without the texts.
 */
export async function embedTexts(input: { model: EmbeddingModel; texts: string[] }): Promise<number[][]> {
  if (input.texts.length === 0) return []
  if (input.texts.length > EMBEDDING_TEXTS_MAX || input.texts.some((text) => text.length > EMBEDDING_TEXT_MAX)) {
    throw new AiInputError()
  }
  try {
    const { embeddings } = await embedMany({
      model: input.model,
      values: input.texts,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (embeddings.length !== input.texts.length || embeddings.some((e) => e.length !== EMBEDDING_DIMENSIONS)) {
      throw new AiModelError("invalid_output", modelIdOf(input.model))
    }
    return embeddings
  } catch (error) {
    throw error instanceof AiModelError ? error : toAiError(error, input.model)
  }
}

const modelIdOf = (model: EmbeddingModel) => (typeof model === "string" ? model : model.modelId)
