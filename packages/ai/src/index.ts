import { createAnthropic } from "@ai-sdk/anthropic"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAI } from "@ai-sdk/openai"
import { createProviderRegistry, type LanguageModel } from "ai"

export interface AiKeys {
  GROQ_API_KEY?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
}

const PROVIDERS = {
  groq: (keys: AiKeys) => keys.GROQ_API_KEY && createGroq({ apiKey: keys.GROQ_API_KEY }),
  openai: (keys: AiKeys) => keys.OPENAI_API_KEY && createOpenAI({ apiKey: keys.OPENAI_API_KEY }),
  anthropic: (keys: AiKeys) => keys.ANTHROPIC_API_KEY && createAnthropic({ apiKey: keys.ANTHROPIC_API_KEY }),
}

/** Only providers with a key are registered, so an id for a provider without one resolves to null instead of crashing. */
export function resolveModel(id: string, keys: AiKeys): LanguageModel | null {
  const [provider, ...rest] = id.split(":")
  if (!provider || rest.length === 0) throw new Error(`AI_MODEL must look like "provider:model", got "${id}"`)
  if (!(provider in PROVIDERS)) throw new Error(`Unknown AI provider "${provider}" in AI_MODEL`)

  const providers: Parameters<typeof createProviderRegistry>[0] = {}
  for (const [name, create] of Object.entries(PROVIDERS)) {
    const instance = create(keys)
    if (instance) providers[name] = instance
  }
  if (!providers[provider]) return null
  return createProviderRegistry(providers).languageModel(id as `${string}:${string}`)
}
