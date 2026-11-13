import type { CorpusEntry } from "./build-corpus"

export type Counts = { tp: number; fp: number; fn: number; tn: number }
const zero = (): Counts => ({ tp: 0, fp: 0, fn: 0, tn: 0 })

export const precision = ({ tp, fp }: Counts) => (tp + fp === 0 ? 1 : tp / (tp + fp))
export const recall = ({ tp, fn }: Counts) => (tp + fn === 0 ? 1 : tp / (tp + fn))
export const falsePositiveRate = ({ fp, tn }: Counts) => (fp + tn === 0 ? 0 : fp / (fp + tn))

function tally(entries: CorpusEntry[], flagged: boolean[], keep: (entry: CorpusEntry) => boolean): Counts {
  const counts = zero()
  entries.forEach((entry, index) => {
    if (!keep(entry)) return
    const positive = entry.expected !== null
    if (positive) counts[flagged[index] ? "tp" : "fn"]++
    else counts[flagged[index] ? "fp" : "tn"]++
  })
  return counts
}

export type Report = {
  overall: Counts
  mainstream: Counts
  byCategory: Record<string, Counts>
  byLang: Record<string, Counts>
  bySet: Record<string, Counts>
  /** Ordinary questions that were blocked, soft ones apart. */
  falsePositives: { hard: CorpusEntry[]; soft: CorpusEntry[] }
  misses: CorpusEntry[]
}

/** Languages the guard has word lists for today. */
export const LISTED_LANGS = new Set(["en", "fr", "de", "es", "ar"])

export function evaluate(entries: CorpusEntry[], flagged: boolean[]): Report {
  const group = (key: (entry: CorpusEntry) => string | null) => {
    const out: Record<string, Counts> = {}
    for (const name of new Set(entries.map(key))) if (name) out[name] = tally(entries, flagged, (e) => key(e) === name)
    return out
  }
  const falsePositives = { hard: [] as CorpusEntry[], soft: [] as CorpusEntry[] }
  const misses: CorpusEntry[] = []
  entries.forEach((entry, index) => {
    if (entry.expected === null && flagged[index]) falsePositives[entry.soft ? "soft" : "hard"].push(entry)
    if (entry.expected !== null && !flagged[index]) misses.push(entry)
  })
  return {
    overall: tally(entries, flagged, () => true),
    mainstream: tally(
      entries,
      flagged,
      (e) => (LISTED_LANGS.has(e.lang) && ["core", "decorated"].includes(e.set)) || e.expected === null,
    ),
    byCategory: group((e) => e.expected),
    byLang: group((e) => e.lang),
    bySet: group((e) => e.set),
    falsePositives,
    misses,
  }
}

export async function loadCorpus(): Promise<CorpusEntry[]> {
  const text = await Bun.file(new URL("./sensitive-corpus.jsonl", import.meta.url)).text()
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CorpusEntry)
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

/** One markdown block per report. */
export function renderReport(name: string, report: Report): string {
  const rows = (groups: Record<string, Counts>, positives = true) =>
    Object.entries(groups)
      .map(([key, c]) =>
        positives
          ? `| ${key} | ${c.tp + c.fn} | ${pct(recall(c))} |`
          : `| ${key} | ${c.fp + c.tn} | ${pct(falsePositiveRate(c))} |`,
      )
      .join("\n")
  const sensitiveOnly = (groups: Record<string, Counts>) =>
    Object.fromEntries(Object.entries(groups).filter(([, c]) => c.tp + c.fn > 0))
  const negativeOnly = (groups: Record<string, Counts>) =>
    Object.fromEntries(Object.entries(groups).filter(([, c]) => c.fp + c.tn > 0))
  return [
    `## ${name}`,
    `precision ${pct(precision(report.overall))}, recall ${pct(recall(report.overall))}, false positive rate ${pct(falsePositiveRate(report.overall))}`,
    `ordinary questions blocked: ${report.falsePositives.hard.length} hard, ${report.falsePositives.soft.length} soft (accepted over-blocks)`,
    "",
    "| category | n | recall |\n|---|---|---|",
    rows(sensitiveOnly(report.byCategory)),
    "",
    "| language | sensitive n | recall |\n|---|---|---|",
    rows(sensitiveOnly(report.byLang)),
    "",
    "| language | ordinary n | false positive rate |\n|---|---|---|",
    rows(negativeOnly(report.byLang), false),
    "",
    "| set | n | recall |\n|---|---|---|",
    rows(sensitiveOnly(report.bySet)),
  ].join("\n")
}
