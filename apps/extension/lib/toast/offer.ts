import { NEXT_TOAST_MS } from "../fill-config"
import type { JobBrief } from "../messages"
import type { ToastAction, ToastMessage } from "./view"

export type NextOffer = { matched: JobBrief | null; next: JobBrief | null }
export type OfferNote = "open-failed" | "mark-failed" | "opened" | "marked"

const label = (job: JobBrief): string => `${job.title} at ${job.company}`

/** What the next job toast says for the parts of the offer that are still open. `note` is how the last choice went. */
export function offerMessage({ matched, next }: NextOffer, note?: OfferNote): ToastMessage | null {
  if (!matched && !next) {
    return note === "marked" || note === "opened"
      ? { text: note === "marked" ? "Marked applied." : "Opened in a new tab." }
      : null
  }
  const actions: ToastAction[] = []
  if (next) actions.push("open-next")
  if (matched) actions.push("mark-applied")
  actions.push("not-now", "stop-next")

  const lead =
    note === "open-failed"
      ? "Could not open the next job. "
      : note === "mark-failed"
        ? "Could not mark it applied. "
        : note === "marked"
          ? "Marked applied. "
          : note === "opened"
            ? "Opened in a new tab. "
            : ""
  const ask = matched ? `Submitted ${label(matched)}? ` : ""
  // after a choice a missing next job may have just been opened, so it is not said to be absent
  const queue = next ? `Next in your queue: ${label(next)}.` : note ? "" : "Your queue has nothing else."
  return { text: `${lead}${ask}${queue}`.trim(), actions, dismissMs: NEXT_TOAST_MS }
}
