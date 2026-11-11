import { FILL_ERROR_ACTIONS, FILL_ERROR_TEXT, type FillErrorCode } from "../fill-config"
import type { ToastMessage } from "./view"

export type FillTally = {
  /** Fields now holding a filled value. */
  filled: number
  /** Of those, outlined for the person to check. */
  review: number
  /** Empty fields outlined because a similar saved answer exists. */
  suggested: number
  problem?: FillErrorCode
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const verb = (n: number) => (n === 1 ? "is" : "are")

/** What the toast says once a fill is done, or null while more frames may still report. */
export function resultMessage(tally: FillTally, waitingForFrames: boolean): ToastMessage | null {
  const { filled, review, suggested, problem } = tally
  if (filled + suggested === 0 && problem) {
    return { text: FILL_ERROR_TEXT[problem], actions: FILL_ERROR_ACTIONS[problem] }
  }
  if (filled + suggested === 0) return waitingForFrames ? null : { text: "Nothing to fill" }

  let text =
    filled === 0
      ? `Nothing filled. ${plural(suggested, "suggestion", "suggestions")} ${verb(suggested)} outlined for you to check.`
      : `Filled ${plural(filled, "field", "fields")}.`
  if (filled > 0 && review > 0) text += ` ${review} of them ${verb(review)} outlined in amber to check.`
  if (filled > 0 && suggested > 0) text += ` ${suggested} more ${verb(suggested)} outlined in amber for you to check.`
  if (!problem) return { text }
  const actions = FILL_ERROR_ACTIONS[problem]
  return { text: `${text} Some answers could not be loaded.`, actions: actions.length > 0 ? actions : ["retry"] }
}
