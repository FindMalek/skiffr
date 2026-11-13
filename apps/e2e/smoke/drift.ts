import { createHash } from "node:crypto"
import { z } from "zod"
import type { Target } from "./schema.ts"

export const STATUSES = ["ok", "drift", "gone", "blocked", "error", "skipped"] as const
export type Status = (typeof STATUSES)[number]

/** Written to `baselines/<id>.json`: counts and a hash of the field labels and types, never page text. */
export const baselineSchema = z.strictObject({
  recorded: z.iso.date(),
  collected: z.number().int().min(0),
  filled: z.number().int().min(0),
  outlined: z.number().int().min(0),
  signature: z.string().regex(/^[0-9a-f]{16}$/),
})
export type Baseline = z.output<typeof baselineSchema>

/** Questions about who a person is or what they agree to: the fill must neither ask nor answer them. Not the extension's own list, so a regression there is seen here. */
export const SENSITIVE =
  /gender|ethnic|\brace\b|racial|veteran|disabilit|transgender|sexual|orientation|pronoun|religio|age range|date of birth|birth ?date|diversity|self-?identif|demographic|consent|i agree|agree to (the|our|this)|acknowledg|signature|\bsign\b|privacy|arbitrat|equal employment|\beeo/i

export interface Observation {
  /** An offer toast was shown for the page. */
  toast: boolean
  /** Fields the fill asked the api about, one entry each: what the signature is made of. */
  fields: { label: string; type: string }[]
  /** Labels of everything the fill handled: the fields it asked about plus the controls it changed without asking. */
  handled: string[]
  collected: number
  filled: number
  outlined: number
  /** Fields of the form still empty after the fill. */
  left: number
  /** Fields whose label is sensitive and that were sent to the api. */
  sensitiveAsked: number
  /** Sensitive controls whose value changed. */
  sensitiveFilled: number
  consoleErrors: number
  clickMissed: boolean
}

export interface Verdict {
  status: "ok" | "drift"
  reasons: string[]
  notes: string[]
}

export const normalizeLabel = (label: string): string =>
  label
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s*:]+$/, "")
    .trim()

export function signatureOf(fields: { label: string; type: string }[]): string {
  const lines = fields.map((field) => `${normalizeLabel(field.label)}|${field.type}`).sort()
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16)
}

export function matchesAny(label: string, phrases: string[]): boolean {
  const text = normalizeLabel(label)
  return phrases.some((phrase) => text.includes(phrase.toLowerCase()))
}

export function baselineOf(observation: Observation, recorded: string): Baseline {
  return {
    recorded,
    collected: observation.collected,
    filled: observation.filled,
    outlined: observation.outlined,
    signature: signatureOf(observation.fields),
  }
}

const fellBy = (now: number, before: number, threshold: number): boolean => now < before * (1 - threshold)

export function assess(
  target: Target,
  observation: Observation,
  baseline: Baseline | null,
  options: { threshold: number },
): Verdict {
  const reasons: string[] = []
  const notes: string[] = []
  const { expect } = target

  if (observation.clickMissed) reasons.push("the apply button selector matched nothing")
  if (expect.toast && !observation.toast) reasons.push("no fill offer was shown: detection stopped")
  if (observation.toast || !expect.toast) {
    if (observation.filled < expect.minFilled) {
      reasons.push(`filled ${observation.filled}, expected at least ${expect.minFilled}`)
    }
    for (const word of expect.detect) {
      if (!observation.handled.some((label) => matchesAny(label, [word]))) {
        reasons.push(`required field "${word}" is not detected`)
      }
    }
  }
  if (observation.sensitiveFilled > 0) reasons.push(`${observation.sensitiveFilled} sensitive field(s) were filled`)
  if (observation.sensitiveAsked > 0) reasons.push(`${observation.sensitiveAsked} sensitive field(s) were asked about`)

  if (baseline) {
    if (fellBy(observation.filled, baseline.filled, options.threshold)) {
      reasons.push(`filled fell from ${baseline.filled} to ${observation.filled}`)
    }
    if (fellBy(observation.collected, baseline.collected, options.threshold)) {
      reasons.push(`collected fell from ${baseline.collected} to ${observation.collected}`)
    }
    if (observation.toast && signatureOf(observation.fields) !== baseline.signature) {
      notes.push("field signature changed")
    }
  } else {
    notes.push("no baseline")
  }
  return { status: reasons.length > 0 ? "drift" : "ok", reasons, notes }
}

export interface TargetResult {
  id: string
  ats: string
  status: Status
  reasons: string[]
  notes: string[]
  observation: Omit<Observation, "fields" | "handled"> | null
  /** Non-GET requests the page tried and the runner aborted. */
  writesAborted: number
  ms: number
}
