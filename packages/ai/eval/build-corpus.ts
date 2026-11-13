import {
  COLLISIONS,
  EMPTY,
  INJECTIONS,
  LANGS,
  LONG,
  NEGATIVE,
  OBFUSCATED,
  OPTIONS_ONLY,
  ORDINARY_SECTIONS,
  SECTIONS,
  SENSITIVE,
} from "./corpus-source"

export type CorpusSet =
  | "core"
  | "decorated"
  | "options"
  | "section"
  | "obfuscated"
  | "injection"
  | "long"
  | "empty"
  | "negative"
  | "collision"
  | "negative-section"

/** `expected` is the protected or private category, `null` for a question that must stay fillable. */
export type CorpusEntry = {
  id: string
  lang: string
  label: string
  section?: string
  options?: string[]
  expected: string | null
  set: CorpusSet
  /** A keyword guard blocks it on purpose (accepted over-block in the issue): counted apart. */
  soft?: boolean
}

export function buildCorpus(): CorpusEntry[] {
  const out: CorpusEntry[] = []
  const add = (entry: Omit<CorpusEntry, "id">) =>
    out.push({ id: `c${String(out.length + 1).padStart(4, "0")}`, ...entry })

  for (const [category, byLang] of Object.entries(SENSITIVE)) {
    for (const lang of LANGS) {
      byLang[lang].forEach((label, index) => {
        add({ lang, label, expected: category, set: "core" })
        if (index === 0) add({ lang, label: `${label} *`, expected: category, set: "decorated" })
      })
    }
  }
  for (const entry of OPTIONS_ONLY) {
    add({ lang: entry.lang, label: "Select one", options: entry.options, expected: entry.category, set: "options" })
  }
  for (const entry of SECTIONS) {
    add({
      lang: entry.lang,
      label: entry.label,
      section: entry.section,
      options: entry.options,
      expected: "section",
      set: "section",
    })
  }
  for (const entry of OBFUSCATED) add({ lang: "en", label: entry.label, expected: entry.category, set: "obfuscated" })
  for (const entry of INJECTIONS) add({ lang: "en", label: entry.label, expected: entry.category, set: "injection" })
  for (const entry of LONG) add({ lang: "en", label: entry.label, expected: entry.category, set: "long" })
  for (const entry of EMPTY)
    add({ lang: "en", label: entry.label, options: entry.options, expected: entry.category, set: "empty" })
  for (const lang of LANGS) {
    NEGATIVE[lang].forEach((label, index) => {
      add({ lang, label, expected: null, set: "negative" })
      if (index < 5)
        add({
          lang,
          label,
          section: ORDINARY_SECTIONS[index % ORDINARY_SECTIONS.length],
          expected: null,
          set: "negative-section",
        })
    })
  }
  for (const entry of COLLISIONS)
    add({ lang: "en", label: entry.label, expected: null, set: "collision", ...(entry.soft ? { soft: true } : {}) })
  return out
}

if (import.meta.main) {
  const corpus = buildCorpus()
  await Bun.write(
    new URL("./sensitive-corpus.jsonl", import.meta.url),
    `${corpus.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  )
  const counts: Record<string, number> = {}
  for (const entry of corpus) counts[entry.set] = (counts[entry.set] ?? 0) + 1
  console.log(corpus.length, counts)
}
