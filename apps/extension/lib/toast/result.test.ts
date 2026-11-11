import { expect, test } from "bun:test"
import { resultMessage } from "./result"

const none = { filled: 0, review: 0, suggested: 0 }

test("filled fields, the ones to check and the suggestions are told apart", () => {
  expect(resultMessage({ filled: 2, review: 0, suggested: 1 }, false)?.text).toBe(
    "Filled 2 fields. 1 more is outlined in amber for you to check.",
  )
  expect(resultMessage({ filled: 5, review: 2, suggested: 0 }, false)?.text).toBe(
    "Filled 5 fields. 2 of them are outlined in amber to check.",
  )
  expect(resultMessage({ filled: 1, review: 1, suggested: 0 }, false)?.text).toBe(
    "Filled 1 field. 1 of them is outlined in amber to check.",
  )
})

test("suggestions alone never read as filled", () => {
  const message = resultMessage({ ...none, suggested: 2 }, false)
  expect(message?.text).toBe("Nothing filled. 2 suggestions are outlined for you to check.")
  expect(message?.text).not.toContain("Filled")
})

test("nothing at all waits for other frames, then says so", () => {
  expect(resultMessage(none, true)).toBeNull()
  expect(resultMessage(none, false)).toEqual({ text: "Nothing to fill" })
})

test("a failure with nothing to show is an error with its action, in plain words", () => {
  const unreachable = resultMessage({ ...none, problem: "unreachable" }, false)
  expect(unreachable?.text).toBe("Could not reach skiffr. Check your connection or the server address in settings.")
  expect(unreachable?.actions).toEqual(["retry", "settings"])
  expect(resultMessage({ ...none, problem: "rejected" }, false)?.actions).toEqual(["settings"])
})

test("a partial failure keeps the result and offers the action that fixes it", () => {
  expect(resultMessage({ filled: 1, review: 0, suggested: 0, problem: "unavailable" }, false)).toEqual({
    text: "Filled 1 field. Some answers could not be loaded.",
    actions: ["retry"],
  })
  expect(resultMessage({ filled: 1, review: 0, suggested: 0, problem: "rejected" }, false)?.actions).toEqual([
    "settings",
  ])
  expect(resultMessage({ filled: 1, review: 0, suggested: 0, problem: "no-profile" }, false)?.actions).toEqual([
    "retry",
  ])
})

test("no user text uses the jargon", () => {
  const texts = (["unreachable", "unavailable", "timeout", "rejected"] as const).map(
    (problem) => resultMessage({ ...none, problem }, false)?.text ?? "",
  )
  for (const text of texts) expect(text).not.toMatch(/API|api url/)
})
