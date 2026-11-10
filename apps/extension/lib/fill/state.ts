let running = 0

/** While the engine writes to the page its own focus, blur and click events are not user edits. */
export function beginFill(): () => void {
  running++
  let done = false
  return () => {
    if (done) return
    done = true
    running--
  }
}

export const isFilling = () => running > 0
