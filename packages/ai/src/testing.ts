import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test"

/** A model that answers with `reply`, or throws it when it is an error. */
export function mockModel(reply: string | Error) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      if (reply instanceof Error) throw reply
      return {
        content: [{ type: "text", text: reply }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }
    },
  })
}

/** An embedding model that vectorizes each text with `vectorOf`, or throws when given an error. */
export function mockEmbeddingModel(vectorOf: ((text: string) => number[]) | Error) {
  return new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => {
      if (vectorOf instanceof Error) throw vectorOf
      return { embeddings: values.map(vectorOf), usage: { tokens: values.length }, warnings: [] }
    },
  })
}
