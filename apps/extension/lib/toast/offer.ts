import { NEXT_TOAST_MS } from "../fill-config"
import type { JobBrief } from "../messages"
import type { ToastAction, ToastMessage } from "./view"

export type NextOffer = { matched: JobBrief | null; next: JobBrief | null }
export const EXPIRED_MESSAGE: ToastMessage = { text: "This offer has expired." }
export type OfferNote = "open-failed" | "mark-failed" | "opened" | "marked"

/** First strong isolate to pop directional isolate: a title in another script keeps its own order inside the sentence. The worker already turned any such character in a title into a visible code. */
const isolate = (text: string): string => `\u2068${text}\u2069`
const label = (job: JobBrief): string => `${isolate(job.title)} at ${isolate(job.company)}`

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
  return { text: `${lead}${ask}${queue}`.trim(), actions, size: "offer", dismissMs: NEXT_TOAST_MS }
}
