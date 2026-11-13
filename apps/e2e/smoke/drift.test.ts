import { describe, expect, test } from "bun:test"
import { assess, baselineOf, baselineSchema, type Observation, signatureOf } from "./drift.ts"
import { parseTargets } from "./schema.ts"

const [target] = parseTargets([
  {
    id: "t",
    ats: "lever",
    url: "https://jobs.lever.co/acme/1/apply",
    checked: "2026-11-12",
    expect: { minFilled: 3, detect: ["email"], untouched: ["pronouns"] },
  },
])
if (!target) throw new Error("no target")

const FIELDS = [
  { label: "Full name", type: "text" },
  { label: "Email *", type: "email" },
  { label: "Phone", type: "tel" },
  { label: "Current company", type: "text" },
]

const seen = (over: Partial<Observation> = {}): Observation => ({
  toast: true,
  fields: FIELDS,
  handled: FIELDS.map((field) => field.label),
  collected: 4,
  filled: 4,
  outlined: 1,
  left: 0,
  sensitiveAsked: 0,
  sensitiveFilled: 0,
  consoleErrors: 0,
  clickMissed: false,
  ...over,
})

const baseline = baselineOf(seen(), "2026-11-12")
const run = (observation: Observation, withBaseline = true) =>
  assess(target, observation, withBaseline ? baseline : null, { threshold: 0.25 })

describe("assess", () => {
  test("a run like the baseline is ok", () => {
    expect(run(seen())).toEqual({ status: "ok", reasons: [], notes: [] })
  })

  test("detection that stops is drift", () => {
    const verdict = run(seen({ toast: false, fields: [], handled: [], collected: 0, filled: 0 }))
    expect(verdict.status).toBe("drift")
    expect(verdict.reasons[0]).toMatch(/detection stopped/)
  })

  test("a fill below the minimum is drift", () => {
    expect(run(seen({ filled: 2 })).reasons.join()).toMatch(/at least 3/)
  })

  test("a fill that fell more than the threshold against the baseline is drift, a small dip is not", () => {
    const big = assess(target, seen({ filled: 3 }), { ...baseline, filled: 6 }, { threshold: 0.25 })
    expect(big.reasons.join()).toMatch(/filled fell from 6 to 3/)
    expect(assess(target, seen({ filled: 3 }), { ...baseline, filled: 4 }, { threshold: 0.25 }).status).toBe("ok")
  })

  test("collected fields that vanish are drift", () => {
    expect(run(seen({ collected: 2 })).reasons.join()).toMatch(/collected fell/)
  })

  test("a required field that is gone is drift", () => {
    const verdict = run(seen({ handled: FIELDS.map((field) => field.label).filter((label) => !/email/i.test(label)) }))
    expect(verdict.reasons).toContain('required field "email" is not detected')
  })

  test("a sensitive field that was filled or asked is drift", () => {
    expect(run(seen({ sensitiveFilled: 1 })).reasons.join()).toMatch(/sensitive field\(s\) were filled/)
    expect(run(seen({ sensitiveAsked: 2 })).reasons.join()).toMatch(/2 sensitive field\(s\) were asked/)
  })

  test("a missed apply button is drift", () => {
    expect(run(seen({ clickMissed: true })).status).toBe("drift")
  })

  test("no baseline and a changed signature are notes, not drift", () => {
    expect(run(seen(), false).notes).toEqual(["no baseline"])
    const changed = run(seen({ fields: [...FIELDS, { label: "Referral", type: "text" }] }))
    expect(changed).toEqual({ status: "ok", reasons: [], notes: ["field signature changed"] })
  })

  test("a page that is not expected to offer a fill is judged without one", () => {
    const quiet = { ...target, expect: { ...target.expect, toast: false, minFilled: 0, detect: [] } }
    expect(
      assess(quiet, seen({ toast: false, fields: [], handled: [], collected: 0, filled: 0 }), null, { threshold: 0.25 })
        .status,
    ).toBe("ok")
  })
})

describe("signature and baseline", () => {
  test("the signature ignores order, case, spacing and a trailing star", () => {
    const shuffled = [...FIELDS].reverse().map((field) => ({ ...field, label: `  ${field.label.toUpperCase()}  ` }))
    expect(signatureOf(shuffled)).toBe(signatureOf(FIELDS))
  })

  test("a label or type change changes it", () => {
    expect(signatureOf([{ label: "Phone", type: "text" }])).not.toBe(signatureOf([{ label: "Phone", type: "tel" }]))
  })

  test("a baseline holds counts and a hash and nothing else", () => {
    expect(Object.keys(baseline).sort()).toEqual(["collected", "filled", "outlined", "recorded", "signature"])
    expect(baselineSchema.safeParse({ ...baseline, labels: ["Email"] }).success).toBe(false)
    expect(JSON.stringify(baseline)).not.toMatch(/email|phone|name/i)
  })
})
