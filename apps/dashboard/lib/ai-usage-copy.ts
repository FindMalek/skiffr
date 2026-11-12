import type { AiUsage } from "@skiffr/common/schemas"

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

const used = (count: number, limit: number, compactCount = false) => {
  const format = (n: number) => (compactCount ? compact.format(n) : String(n))
  return limit > 0 ? `${format(count)} of ${format(limit)}` : format(count)
}

/** "12 of 300 calls and 41K of 1M tokens used today", without the "of" for a limit of 0, which is no limit. */
export function usageLine({ calls, tokens, limits }: AiUsage): string {
  const spent = `${used(calls, limits.calls)} ${calls === 1 && limits.calls === 0 ? "call" : "calls"} and ${used(tokens, limits.tokens, true)} tokens used today`
  return limits.calls === 0 && limits.tokens === 0 ? `${spent}. No daily limit.` : `${spent}. Resets at midnight UTC.`
}
