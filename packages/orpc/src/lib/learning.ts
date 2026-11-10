import { createHash } from "node:crypto"
import { AiInputError, AiModelError } from "@skiffr/ai"
import { EMBEDDING_TEXT_MAX } from "@skiffr/common/constants"
import { normalizeLabel } from "@skiffr/common/utils"

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

/** Model failures are logged as name, kind, status, model id and request id only: nothing from the request, which holds the user's labels. */
export function logEmbeddingFailure(route: string, error: unknown): void {
  if (error instanceof AiModelError) {
    const { name, kind, status, modelId, requestId } = error
    console.error(`[${route}] embeddings failed`, { name, kind, status, modelId, requestId })
  } else if (error instanceof AiInputError) {
    console.error(`[${route}] embeddings skipped`, { name: error.name })
  } else {
    throw error
  }
}
