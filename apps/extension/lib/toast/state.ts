export type ToastState = { phase: "idle" | "shown" | "closed"; blocked: boolean }
export type ToastEvent = "detected" | "yes" | "no" | "never" | "timeout" | "navigated" | "blocked" | "filled"
export type ToastEffect = "show" | "hide" | "fill" | "neverAsk"

export const INITIAL_TOAST_STATE: ToastState = { phase: "idle", blocked: false }

type Step = { state: ToastState; effects: ToastEffect[] }

function close(state: ToastState, ...effects: ToastEffect[]): Step {
  if (state.phase !== "shown") return { state, effects: [] }
  return { state: { ...state, phase: "closed" }, effects: ["hide", ...effects] }
}

export function reduceToast(state: ToastState, event: ToastEvent): Step {
  switch (event) {
    case "detected":
      if (state.phase !== "idle" || state.blocked) return { state, effects: [] }
      return { state: { ...state, phase: "shown" }, effects: ["show"] }
    case "yes":
      return close(state, "fill")
    case "no":
    case "timeout":
    case "filled":
      return close(state)
    case "never": {
      const step = close(state, "neverAsk")
      return { ...step, state: { ...step.state, blocked: true } }
    }
    case "blocked":
      return close({ ...state, blocked: true })
    case "navigated":
      return { state: { ...state, phase: "idle" }, effects: state.phase === "shown" ? ["hide"] : [] }
  }
}
