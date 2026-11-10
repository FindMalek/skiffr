import { type CollectedField, collectFields, type FillPageInput, type FillSummary, fillPage } from "./fill"

export type MappingResult = Pick<FillPageInput, "mapping" | "values" | "files">
export type MappingProvider = (fields: CollectedField[]) => Promise<MappingResult | null>
export type FillOutcome = { ok: true; summary: FillSummary } | { ok: false; reason: string }

const NO_PROVIDER: MappingProvider = async () => null
let provider: MappingProvider = NO_PROVIDER

/** Where the field mapping comes from. Until one is set nothing is filled. */
export function setMappingProvider(next: MappingProvider | null): void {
  provider = next ?? NO_PROVIDER
}

export async function handleFill(root: ParentNode = document): Promise<FillOutcome> {
  const outcome = await run(root)
  if (import.meta.env.DEV)
    console.debug("[skiffr] fill requested", outcome.ok ? outcome.summary.counts : outcome.reason)
  return outcome
}

async function run(root: ParentNode): Promise<FillOutcome> {
  try {
    const fields = collectFields(root)
    const mapped = await provider(fields)
    if (!mapped) return { ok: false, reason: "no mapping provider" }
    return { ok: true, summary: await fillPage({ ...mapped, root, fields }) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "fill failed" }
  }
}
