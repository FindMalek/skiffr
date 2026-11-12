import { APICallError, NoObjectGeneratedError, RetryError } from "ai"

export type AiErrorKind = "timeout" | "invalid_output" | "provider" | "budget"

/** The only error that leaves this package. The SDK's own errors carry the whole request body (the applicant's data), so nothing from them is kept except these fields. */
export class AiModelError extends Error {
  override name = "AiModelError"
  constructor(
    readonly kind: AiErrorKind,
    readonly modelId: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super("The AI model call failed.")
  }
}

/** Thrown by whoever wraps a model when the user's budget is spent, before the provider is called. */
export class ModelBudgetError extends Error {
  override name = "ModelBudgetError"
  constructor() {
    super("The model budget is spent.")
  }
}

/** The request is too big to send. Raised before any model call, so it is the caller's to fix and safe to show. */
export class AiInputError extends Error {
  override name = "AiInputError"
  constructor() {
    super("The request is too large for the AI.")
  }
}

export function modelIdOf(model: unknown): string {
  if (typeof model === "string") return model
  const id = (model as { modelId?: unknown } | null)?.modelId
  return typeof id === "string" ? id : "unknown"
}

export function toAiError(error: unknown, model: unknown): AiModelError {
  const modelId = modelIdOf(model)
  const cause = RetryError.isInstance(error) ? error.lastError : error
  if (cause instanceof ModelBudgetError) return new AiModelError("budget", modelId)
  if (APICallError.isInstance(cause)) {
    return new AiModelError("provider", modelId, cause.statusCode, cause.responseHeaders?.["x-request-id"])
  }
  if (NoObjectGeneratedError.isInstance(cause)) return new AiModelError("invalid_output", modelId)
  const name = (cause as { name?: string } | null)?.name
  if (name === "TimeoutError" || name === "AbortError") return new AiModelError("timeout", modelId)
  return new AiModelError("provider", modelId)
}
