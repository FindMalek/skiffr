/**
 * `pnpm --filter @skiffr/ai eval:sensitive [--only=a,b,c,d-20b,d-safeguard,e] [--out=file.md]`
 *
 * Arms: a current regex, b trimmed floor, c fake embedder (always), c-local (a real multilingual embedding model on this
 * machine, off by default, see local-embedder.ts), c-real (needs OPENAI_API_KEY), d-20b and d-safeguard
 * (need GROQ_API_KEY), e combined stack (needs a d arm). Arms whose key is missing are reported as not measured.
 */
import { createGroq } from "@ai-sdk/groq"
import { createOpenAI } from "@ai-sdk/openai"
import { embedMany } from "ai"
import { type Arm, type Embedder, embeddingArm, fakeEmbedder, floorArm, fullRegexArm, indexPrototypes } from "./arms"
import { llmArm, type Usage } from "./llm-arm"
import { localEmbedder } from "./local-embedder"
import { evaluate, falsePositiveRate, loadCorpus, precision, type Report, recall, renderReport } from "./metrics"
import { ORDINARY_PROTOTYPES, SENSITIVE_PROTOTYPES } from "./prototypes"

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]))
const wanted = new Set((args.get("only") ?? "a,b,c,c-real,d-20b,d-safeguard,e").split(","))
const corpus = await loadCorpus()

/** Public list prices, USD per million tokens, as read from the providers' pages when this was written. */
const PRICE = { groq20b: { in: 0.075, out: 0.3 }, embedding3small: 0.02 }
const FIELDS_PER_FORM = 25

type Row = { name: string; report?: Report; ms?: string; cost?: string; offline: string; note: string }
const rows: Row[] = []
const sections: string[] = []
const verdicts = new Map<string, boolean[]>()

async function measure(id: string, arm: Arm, extra: Partial<Row> = {}): Promise<Row | null> {
  if (!wanted.has(id)) return null
  const began = Date.now()
  const flagged = await arm.classify(corpus)
  const ms = Date.now() - began
  const report = evaluate(corpus, flagged)
  verdicts.set(id, flagged)
  sections.push(renderReport(arm.name, report))
  const row: Row = {
    name: arm.name,
    report,
    ms: extra.ms ?? `${(ms / corpus.length).toFixed(2)} ms/field local`,
    cost: extra.cost ?? "0",
    offline: extra.offline ?? "yes",
    note: extra.note ?? arm.needs,
  }
  rows.push(row)
  return row
}

await measure("a", fullRegexArm, { ms: "<0.1 ms/field", note: "server: floor plus long lists" })
await measure("b", floorArm, { ms: "<0.1 ms/field", note: "content script, fail closed" })

const fakeArm = embeddingArm(
  "C embeddings nearest prototype (fake char n-gram embedder)",
  "nothing, CI safe",
  fakeEmbedder,
  () => indexPrototypes(fakeEmbedder, SENSITIVE_PROTOTYPES, ORDINARY_PROTOTYPES),
)
await measure("c", fakeArm, { note: "not a real embedding model, a CI stand-in" })
if (fakeArm.thresholds)
  sections.push(
    `thresholds tuned on this corpus: min ${fakeArm.thresholds.min.toFixed(2)}, margin ${fakeArm.thresholds.margin.toFixed(2)}`,
  )

if (wanted.has("c-real")) {
  const key = process.env.OPENAI_API_KEY
  if (!key)
    rows.push({
      name: "C embeddings nearest prototype (text-embedding-3-small)",
      offline: "no",
      note: "NOT MEASURED: set OPENAI_API_KEY",
    })
  else {
    const model = createOpenAI({ apiKey: key }).embedding("text-embedding-3-small")
    let tokens = 0
    const real: Embedder = async (texts) => {
      const out: number[][] = []
      for (let i = 0; i < texts.length; i += 100) {
        const { embeddings, usage } = await embedMany({ model, values: texts.slice(i, i + 100), maxRetries: 2 })
        tokens += usage.tokens
        out.push(...embeddings)
      }
      return out
    }
    const index = indexPrototypes(real, SENSITIVE_PROTOTYPES, ORDINARY_PROTOTYPES)
    const arm = embeddingArm(
      "C embeddings nearest prototype (text-embedding-3-small)",
      "OPENAI_API_KEY, network",
      real,
      () => index,
    )
    const began = Date.now()
    const row = await measure("c-real", arm, { offline: "no" })
    if (row) {
      row.ms = `${((Date.now() - began) / corpus.length).toFixed(1)} ms/field batched`
      row.cost = `$${(((tokens / corpus.length) * FIELDS_PER_FORM * 1000 * PRICE.embedding3small) / 1e6).toFixed(4)} per 1000 forms`
    }
    if (arm.thresholds)
      sections.push(
        `thresholds tuned on this corpus: min ${arm.thresholds.min.toFixed(2)}, margin ${arm.thresholds.margin.toFixed(2)}`,
      )
  }
}

if (wanted.has("c-local")) {
  const local = await localEmbedder()
  const cache = new Map<string, Promise<number[][]>>()
  const embed: Embedder = (texts) => {
    const key = texts.join("\u0000")
    cache.set(key, cache.get(key) ?? local(texts))
    return cache.get(key) as Promise<number[][]>
  }
  const index = indexPrototypes(embed, SENSITIVE_PROTOTYPES, ORDINARY_PROTOTYPES)
  for (const maxFpr of [0.02, 0.05]) {
    const arm = embeddingArm(
      `C embeddings nearest prototype (local multilingual-e5-small proxy, FPR cap ${maxFpr * 100}%)`,
      "a local model download",
      embed,
      () => index,
      { maxFpr },
    )
    await measure("c-local", arm, {
      note: "proxy for text-embedding-3-small, offline after the download, thresholds tuned on this corpus",
    })
    if (arm.thresholds)
      sections.push(
        `thresholds tuned on this corpus: min ${arm.thresholds.min.toFixed(2)}, margin ${arm.thresholds.margin.toFixed(2)}`,
      )
  }
}

const groqKey = process.env.GROQ_API_KEY
for (const [id, modelId, label] of [
  ["d-20b", "openai/gpt-oss-20b", "D llm verdict, groq gpt-oss-20b"],
  ["d-safeguard", "openai/gpt-oss-safeguard-20b", "D llm verdict, groq gpt-oss-safeguard-20b"],
] as const) {
  if (!wanted.has(id)) continue
  if (!groqKey) {
    rows.push({ name: label, offline: "no", note: "NOT MEASURED: set GROQ_API_KEY" })
    continue
  }
  const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0, missing: 0, errors: 0 }
  const arm = llmArm(label, "GROQ_API_KEY, network", createGroq({ apiKey: groqKey })(modelId), usage)
  const row = await measure(id, arm, { offline: "no" })
  if (row) {
    const forms = corpus.length / FIELDS_PER_FORM
    row.ms = `${(usage.ms / Math.max(1, usage.calls)).toFixed(0)} ms per ${FIELDS_PER_FORM} field call`
    const dollars = (usage.inputTokens * PRICE.groq20b.in + usage.outputTokens * PRICE.groq20b.out) / 1e6
    row.cost = `$${((dollars / forms) * 1000).toFixed(3)} per 1000 forms`
    row.note = `${usage.calls} calls, ${usage.missing} missing verdicts and ${usage.errors} failed batches (all counted sensitive)`
  }
}

if (wanted.has("e")) {
  const model = verdicts.get("d-20b") ?? verdicts.get("d-safeguard")
  const regex = verdicts.get("a")
  const name = "E stack: floor + server lists + model verdict"
  if (!model || !regex)
    rows.push({ name, offline: "floor and lists only", note: "NOT MEASURED: needs a d arm (GROQ_API_KEY)" })
  else {
    const report = evaluate(
      corpus,
      corpus.map((_, i) => Boolean(regex[i]) || Boolean(model[i])),
    )
    sections.push(renderReport(name, report))
    rows.push({
      name,
      report,
      ms: "inside the mapping call",
      cost: "marginal, see D",
      offline: "floor and lists only",
      note: "regex flags never reach the model",
    })
  }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const table = [
  "| arm | precision | recall | false positive rate | hard FPs | latency | cost | offline | note |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) =>
    r.report
      ? `| ${r.name} | ${pct(precision(r.report.overall))} | ${pct(recall(r.report.overall))} | ${pct(falsePositiveRate(r.report.overall))} | ${r.report.falsePositives.hard.length} | ${r.ms} | ${r.cost} | ${r.offline} | ${r.note} |`
      : `| ${r.name} | - | - | - | - | - | - | ${r.offline} | ${r.note} |`,
  ),
].join("\n")

const out = [`# sensitive field classifier eval (${corpus.length} labels)`, "", table, "", ...sections].join("\n")
console.log(out)
const file = args.get("out")
if (file) await Bun.write(file, `${out}\n`)
