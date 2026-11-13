import * as floor from "../src/learnable"
import * as full from "../src/learnable-extended"
import type { CorpusEntry } from "./build-corpus"

export type Verdicts = boolean[]
/** One arm answers for the whole corpus at once, so a model arm can batch. `true` means sensitive. */
export type Arm = {
  name: string
  /** Where it runs and what it needs, for the report. */
  needs: string
  classify: (entries: CorpusEntry[]) => Promise<Verdicts>
}

const question = (entry: CorpusEntry) => ({
  label: entry.label,
  options: entry.options,
  sections: entry.section ? [entry.section] : [],
})

export const floorArm: Arm = {
  name: "B trimmed regex floor",
  needs: "nothing, runs in the content script",
  classify: async (entries) => entries.map((entry) => floor.isSensitiveQuestion(question(entry))),
}

export const fullRegexArm: Arm = {
  name: "A current regex (floor plus server lists)",
  needs: "nothing, runs on the server",
  classify: async (entries) => entries.map((entry) => full.isSensitiveQuestion(question(entry))),
}

// ---------------------------------------------------------------------------------------------------------------------
// embeddings, nearest prototype

export type Embedder = (texts: string[]) => Promise<number[][]>

const FAKE_DIMENSIONS = 512

/**
 * Deterministic stand-in for an embedding model: hashed character 2 to 4 grams of the folded text, L2 normalized. It
 * knows nothing about meaning, only about shared letters, so it is a floor for the arm (and a CI-safe one), not an
 * estimate of what `text-embedding-3-small` does.
 */
export const fakeEmbedder: Embedder = async (texts) =>
  texts.map((text) => {
    const folded = ` ${text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()} `
    const vector = new Array<number>(FAKE_DIMENSIONS).fill(0)
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= folded.length; i++) {
        let hash = 2166136261
        for (const char of folded.slice(i, i + n)) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619)
        const slot = (hash >>> 0) % FAKE_DIMENSIONS
        vector[slot] = (vector[slot] ?? 0) + 1
      }
    }
    const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1
    return vector.map((x) => x / norm)
  })

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0)

/** What gets embedded for a field: the question, with a few of its answers when the label is empty or generic. */
export const embeddingText = (entry: CorpusEntry) =>
  [entry.section, entry.label.trim().slice(0, 300), (entry.options ?? []).slice(0, 6).join(", ")]
    .filter(Boolean)
    .join(" | ")

export type Thresholds = { min: number; margin: number }

export type PrototypeIndex = {
  sensitive: { category: string; vector: number[] }[]
  ordinary: number[][]
}

export async function indexPrototypes(
  embed: Embedder,
  sensitive: Record<string, string[]>,
  ordinary: string[],
): Promise<PrototypeIndex> {
  const flat = Object.entries(sensitive).flatMap(([category, texts]) => texts.map((text) => ({ category, text })))
  const vectors = await embed([...flat.map((p) => p.text), ...ordinary])
  return {
    sensitive: flat.map((p, i) => ({ category: p.category, vector: vectors[i] as number[] })),
    ordinary: vectors.slice(flat.length) as number[][],
  }
}

/** Best similarity to a sensitive prototype and to an ordinary one. */
export function scoreVector(
  vector: number[],
  index: PrototypeIndex,
): { best: number; category: string; ordinary: number } {
  let best = -1
  let category = "other"
  for (const prototype of index.sensitive) {
    const sim = dot(vector, prototype.vector)
    if (sim > best) {
      best = sim
      category = prototype.category
    }
  }
  return { best, category, ordinary: Math.max(...index.ordinary.map((vec) => dot(vector, vec))) }
}

export const decide = (score: { best: number; ordinary: number }, { min, margin }: Thresholds) =>
  score.best >= min && score.best - score.ordinary >= margin

/** The grid point with the best F1 whose false positive rate stays at or under `maxFpr`. Tuned on the corpus it is then scored on, so the number it gives is optimistic. */
export function tune(scores: { best: number; ordinary: number }[], entries: CorpusEntry[], maxFpr = 0.05): Thresholds {
  let winner: Thresholds & { f1: number } = { min: 1, margin: 1, f1: -1 }
  const positives = entries.filter((e) => e.expected !== null).length
  const negatives = entries.length - positives
  for (let min = 0.1; min <= 0.95; min += 0.01) {
    for (let margin = -0.2; margin <= 0.3; margin += 0.01) {
      let tp = 0
      let fp = 0
      scores.forEach((score, i) => {
        if (!decide(score, { min, margin })) return
        if (entries[i]?.expected === null) fp++
        else tp++
      })
      if (fp / negatives > maxFpr) continue
      const f1 = (2 * tp) / (2 * tp + fp + (positives - tp))
      if (f1 > winner.f1) winner = { min, margin, f1 }
    }
  }
  return { min: winner.min, margin: winner.margin }
}

export function embeddingArm(
  name: string,
  needs: string,
  embed: Embedder,
  index: () => Promise<PrototypeIndex>,
  { thresholds, maxFpr }: { thresholds?: Thresholds; maxFpr?: number } = {},
): Arm & { thresholds?: Thresholds } {
  const arm: Arm & { thresholds?: Thresholds } = {
    name,
    needs,
    classify: async (entries) => {
      const proto = await index()
      const readable = entries.map((entry) => entry.label.trim() !== "" || (entry.options?.length ?? 0) > 0)
      const vectors = await embed(entries.filter((_, i) => readable[i]).map(embeddingText))
      let next = 0
      const scores = entries.map((_, i) =>
        readable[i] ? scoreVector(vectors[next++] as number[], proto) : { best: -1, ordinary: 0 },
      )
      const used = thresholds ?? tune(scores, entries, maxFpr)
      arm.thresholds = used
      return scores.map((score) => decide(score, used))
    },
  }
  return arm
}
