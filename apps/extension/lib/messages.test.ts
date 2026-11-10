import { expect, test } from "bun:test"
import { isFillMessage, isFormDetectedMessage } from "./messages"

test("messages with unknown shapes are rejected", () => {
  expect(isFillMessage({ type: "fill" })).toBe(true)
  expect(isFillMessage({ type: "fill", skipTop: true })).toBe(true)
  expect(isFillMessage({ type: "fill", skipTop: "yes" })).toBe(false)
  expect(isFillMessage({ type: "fill", extra: 1 })).toBe(false)
  expect(isFormDetectedMessage({ type: "form-detected", frameId: 0 })).toBe(false)
  expect(isFormDetectedMessage(null)).toBe(false)
})
