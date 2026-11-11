import { detectApplicationForm } from "./detect/score"
import { parentOf } from "./fill/dom"

const REGION =
  "form, [role=form], [role=search], [role=region], [role=complementary], [role=contentinfo], [role=banner], [role=dialog], [role=alertdialog], dialog"
const DIALOG = "[role=dialog], [role=alertdialog], dialog"
const NEEDS_BUTTONS = "form, [role=form], [role=dialog], [role=alertdialog], dialog"
const NOISE = /\b(newsletter|subscribe|subscription|comments?|search|log ?in|sign ?in|cookies?|consent)\b/i

function textOf(el: Element): string {
  return el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || ""
}

/** What the page itself calls a region: its label and, for a form or dialog, what its buttons say. Never its id, class or action. */
function nameOf(region: Element): string {
  const parts = [region.getAttribute("aria-label") ?? ""]
  const root = region.getRootNode() as Document | ShadowRoot
  for (const id of (region.getAttribute("aria-labelledby") ?? "").split(/\s+/)) {
    if (id) parts.push(root.getElementById?.(id)?.textContent ?? "")
  }
  if (region.matches(NEEDS_BUTTONS)) {
    parts.push(
      ...Array.from(region.querySelectorAll("button, input[type=submit], input[type=button], [role=button]"))
        .slice(0, 4)
        .map(textOf),
    )
  }
  return parts.join(" ")
}

export type NoiseFilter = (el: HTMLElement) => boolean

/**
 * What a fill never reads. Everything else on the page is asked about, in or out of the application's own form: a missed
 * field costs more than an extra label. Noise is a search box, a region the page itself names as a newsletter, comment,
 * search, login or cookie box, and any other dialog (a chat widget, a consent box) that does not hold the application.
 * A region that holds the detected application is never noise.
 */
export function createNoiseFilter(doc: Document): NoiseFilter {
  const found = detectApplicationForm(doc)
  const container =
    found.isForm && found.container && found.container !== doc.body && found.container !== doc.documentElement
      ? found.container
      : null
  const verdicts = new Map<Element, boolean>()

  function noisy(region: Element): boolean {
    if (container && (region === container || region.contains(container))) return false
    if (region.getAttribute("role") === "search") return true
    if (container && region.matches(DIALOG) && !container.contains(region)) return true
    return NOISE.test(nameOf(region))
  }

  return (el) => {
    if (el.closest("[role=searchbox]")) return true
    const regions: Element[] = []
    for (let node: HTMLElement | null = el, depth = 0; node && depth < 60; node = parentOf(node), depth++) {
      if (node.matches(REGION)) regions.push(node)
    }
    const owner = (el as HTMLInputElement).form
    if (owner && !regions.includes(owner)) regions.push(owner)
    return regions.some((region) => {
      let verdict = verdicts.get(region)
      if (verdict === undefined) {
        verdict = noisy(region)
        verdicts.set(region, verdict)
      }
      return verdict
    })
  }
}
