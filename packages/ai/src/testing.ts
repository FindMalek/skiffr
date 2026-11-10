import { MockLanguageModelV4 } from "ai/test"

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
