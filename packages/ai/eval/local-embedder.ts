import type { Embedder } from "./arms"

/**
 * A real multilingual embedding model that runs on this machine, for measuring the embedding arm without a key. It is a
 * proxy for `text-embedding-3-small`, not the same model. Install it outside the repo first:
 * `npm i --no-save @huggingface/transformers` in `packages/ai`. The model (about 120 MB) is downloaded on first use.
 */
export async function localEmbedder(): Promise<Embedder> {
  const library = "@huggingface/transformers"
  const { pipeline } = (await import(library).catch(() => {
    throw new Error("install @huggingface/transformers to run the c-local arm")
  })) as {
    pipeline: (
      task: string,
      model: string,
      options: object,
    ) => Promise<(texts: string[], options: object) => Promise<{ dims: number[]; data: Float32Array }>>
  }
  const extract = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", { dtype: "q8" })
  return async (texts) => {
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32)
      const result = await extract(
        batch.map((text) => `query: ${text.slice(0, 400)}`),
        { pooling: "mean", normalize: true },
      )
      const size = result.dims[1] ?? 0
      batch.forEach((_, j) => out.push(Array.from(result.data.slice(j * size, (j + 1) * size))))
    }
    return out
  }
}
