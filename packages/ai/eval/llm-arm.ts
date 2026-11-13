import { generateText, type LanguageModel, Output } from "ai"
import { z } from "zod"
import { dataBlock, UNTRUSTED_NOTICE } from "../src/data"
import { SENSITIVE_CATEGORIES, SENSITIVE_POLICY } from "../src/sensitive"
import type { Arm } from "./arms"
import type { CorpusEntry } from "./build-corpus"

const BATCH = 25

const schema = z.object({
  verdicts: z.array(
    z.object({ id: z.string(), sensitive: z.boolean(), category: z.enum(SENSITIVE_CATEGORIES).nullable() }),
  ),
})

export type Usage = {
  calls: number
  inputTokens: number
  outputTokens: number
  ms: number
  missing: number
  errors: number
}

const describe = (entry: CorpusEntry, id: string) =>
  JSON.stringify({
    id,
    label: entry.label.slice(0, 500),
    ...(entry.section ? { section: entry.section } : {}),
    ...(entry.options?.length ? { options: entry.options.slice(0, 12) } : {}),
  })

/**
 * Standalone verdicts for corpus fields in batches of one form's size, with the production policy as the system text and
 * the fields as an escaped data block. A field the model leaves out, or a batch that fails, counts as sensitive (fail closed)
 * and is tallied in `usage.missing` or `usage.errors`.
 */
export function llmArm(name: string, needs: string, model: LanguageModel, usage: Usage): Arm {
  return {
    name,
    needs,
    classify: async (entries) => {
      const out = new Array<boolean>(entries.length).fill(true)
      for (let start = 0; start < entries.length; start += BATCH) {
        const slice = entries.slice(start, start + BATCH)
        const ids = slice.map((_, i) => `f${start + i}`)
        const prompt = [
          "FIELDS (one JSON object per line):",
          dataBlock("fields", slice.map((e, i) => describe(e, ids[i] as string)).join("\n")),
        ].join("\n")
        const began = Date.now()
        try {
          const result = await generateText({
            model,
            system: `${SENSITIVE_POLICY}\n\nFor every field id return {"id","sensitive","category"}, exactly one entry per id.\n${UNTRUSTED_NOTICE}`,
            temperature: 0,
            maxRetries: 1,
            maxOutputTokens: 4000,
            output: Output.object({ schema }),
            prompt,
          })
          usage.calls++
          usage.inputTokens += result.usage.inputTokens ?? 0
          usage.outputTokens += result.usage.outputTokens ?? 0
          const byId = new Map(result.output.verdicts.map((v) => [v.id, v]))
          ids.forEach((id, i) => {
            const verdict = byId.get(id)
            if (!verdict) usage.missing++
            else out[start + i] = verdict.sensitive
          })
        } catch {
          usage.errors++
        }
        usage.ms += Date.now() - began
      }
      return out
    },
  }
}
