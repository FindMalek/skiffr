import { APICallError, NoObjectGeneratedError, RetryError } from "ai"

export type AiErrorKind = "timeout" | "invalid_output" | "provider"

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

export function modelIdOf(model: unknown): string {
  if (typeof model === "string") return model
  const id = (model as { modelId?: unknown } | null)?.modelId
  return typeof id === "string" ? id : "unknown"
}

export function toAiError(error: unknown, model: unknown): AiModelError {
  const modelId = modelIdOf(model)
  const cause = RetryError.isInstance(error) ? error.lastError : error
  if (APICallError.isInstance(cause)) {
    return new AiModelError("provider", modelId, cause.statusCode, cause.responseHeaders?.["x-request-id"])
  }
  if (NoObjectGeneratedError.isInstance(cause)) return new AiModelError("invalid_output", modelId)
  const name = (cause as { name?: string } | null)?.name
  if (name === "TimeoutError" || name === "AbortError") return new AiModelError("timeout", modelId)
  return new AiModelError("provider", modelId)
}
