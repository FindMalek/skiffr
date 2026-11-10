import { type AtsId, matchAts } from "./ats"
import { type ControlInfo, collectControls, countControlCandidates, MAX_CONTROLS, type Signal } from "./controls"

export type Detection = { isForm: boolean; ats: AtsId | null; confidence: number; reasons: string[] }

const MIN_CONTROLS = 3
const MIN_SIGNALS = 2
const GROUP_SELECTOR = "form, [role=dialog], dialog, [role=form]"
const LINKEDIN_APPLY_SELECTOR = '[data-test-modal-id="easy-apply-modal"], .jobs-easy-apply-modal'
const JOB_CONTEXT =
  /\b(apply|applying|careers?|job (posting|opening|description)|positions?|openings?|resume|cv|hiring|vacanc\w*)\b/i

function groupControls(doc: Document): Map<Element, ControlInfo[]> {
  const groups = new Map<Element, ControlInfo[]>()
  for (const control of collectControls(doc)) {
    const key = control.el.closest(GROUP_SELECTOR) ?? doc.body ?? doc.documentElement
    const list = groups.get(key)
    if (list) list.push(control)
    else groups.set(key, [control])
  }
  return groups
}

function hasJobContext(doc: Document, url: string, group: Element): boolean {
  let path = ""
  try {
    path = new URL(url).pathname
  } catch {
    // an unparsable url just means no path hint
  }
  const headings = [...doc.querySelectorAll("h1, h2")].slice(0, 3).map((heading) => heading.textContent ?? "")
  const submits = [...group.querySelectorAll("button, input[type=submit]")]
    .slice(0, 6)
    .map((button) => button.textContent || (button as HTMLInputElement).value || "")
  return JOB_CONTEXT.test([path.replace(/[-_/]+/g, " "), doc.title, ...headings, ...submits].join(" "))
}

function scoreGroup(doc: Document, url: string, ats: AtsId | null, group: Element, controls: ControlInfo[]) {
  const reasons: string[] = []
  const blocker = controls.find((control) => control.blocker)?.blocker
  const signals = new Set<Signal>(controls.flatMap((control) => control.signals))
  const context = ats !== null || hasJobContext(doc, url, group)
  const resumeLike = signals.has("resume") || signals.has("coverLetter")

  reasons.push(`${controls.length} controls`, `signals: ${[...signals].join(", ") || "none"}`)
  if (ats) reasons.push(`ats url: ${ats}`)
  else if (context) reasons.push("job wording on page")

  let isForm = true
  if (blocker) {
    isForm = false
    reasons.push(`blocked by ${blocker}`)
  } else if (controls.length < MIN_CONTROLS) {
    isForm = false
    reasons.push(`needs ${MIN_CONTROLS} controls`)
  } else if (signals.size < MIN_SIGNALS) {
    isForm = false
    reasons.push(`needs ${MIN_SIGNALS} field signals`)
  } else if (!context && !resumeLike) {
    isForm = false
    reasons.push("no resume, cover letter or job wording")
  }

  const confidence = Math.min(
    1,
    signals.size * 0.2 + (ats ? 0.3 : 0) + (signals.has("resume") ? 0.15 : 0) + (context ? 0.1 : 0),
  )
  return { isForm, confidence: Number(confidence.toFixed(2)), reasons }
}

export function detectApplicationForm(doc: Document, url: string = doc.location?.href ?? ""): Detection {
  let ats = matchAts(url)
  if (ats === "linkedin" && !doc.querySelector(LINKEDIN_APPLY_SELECTOR)) ats = null
  if (countControlCandidates(doc) < MIN_CONTROLS) {
    return { isForm: false, ats, confidence: 0, reasons: ["too few inputs on the page"] }
  }

  if (countControlCandidates(doc) > MAX_CONTROLS) {
    return { isForm: false, ats, confidence: 0, reasons: [`too many controls to analyse (over ${MAX_CONTROLS})`] }
  }

  let best: Detection = { isForm: false, ats, confidence: 0, reasons: ["no form with enough fillable controls"] }
  for (const [group, controls] of groupControls(doc)) {
    const result = scoreGroup(doc, url, ats, group, controls)
    if ((result.isForm && !best.isForm) || (result.isForm === best.isForm && result.confidence > best.confidence)) {
      best = { ...result, ats }
    }
  }
  return best
}
