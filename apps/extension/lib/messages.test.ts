import { expect, test } from "bun:test"
import {
  isChildFormsGoneMessage,
  isFillMessage,
  isFillReportMessage,
  isFormDetectedMessage,
  isFrameNavigatedMessage,
  isOpenOptionsMessage,
  isReportAgainMessage,
  isTestConnectionMessage,
} from "./messages"

test("messages with unknown shapes are rejected", () => {
  expect(isFillMessage({ type: "fill" })).toBe(true)
  expect(isFillMessage({ type: "fill", skipTop: true })).toBe(true)
  expect(isFillMessage({ type: "fill", skipTop: "yes" })).toBe(false)
  expect(isFillMessage({ type: "fill", extra: 1 })).toBe(false)
  expect(isFormDetectedMessage({ type: "form-detected", frameId: 0 })).toBe(false)
  expect(isFormDetectedMessage(null)).toBe(false)
  expect(isTestConnectionMessage({ type: "test-connection" })).toBe(true)
  expect(isTestConnectionMessage({ type: "test-connection", token: "x" })).toBe(false)
  expect(isFrameNavigatedMessage({ type: "frame-navigated" })).toBe(true)
  expect(isFrameNavigatedMessage({ type: "frame-navigated", frameId: 3 })).toBe(false)
  expect(isReportAgainMessage({ type: "report-again" })).toBe(true)
  expect(isReportAgainMessage({ type: "report-again", x: 1 })).toBe(false)
  expect(isChildFormsGoneMessage({ type: "child-forms-gone" })).toBe(true)
  expect(isChildFormsGoneMessage({ type: "child-forms-gone", x: 1 })).toBe(false)
})

test("fill report and open-options messages are strict", () => {
  expect(isFillReportMessage({ type: "fill-report", filled: 2, review: 1 })).toBe(true)
  expect(isFillReportMessage({ type: "fill-report", filled: 2, review: 1, problem: "rejected" })).toBe(true)
  expect(isFillReportMessage({ type: "fill-report", filled: -1, review: 0 })).toBe(false)
  expect(isFillReportMessage({ type: "fill-report", filled: 1, review: 0, problem: "<script>" })).toBe(false)
  expect(isFillReportMessage({ type: "fill-report", filled: 1, review: 0, label: "Salary" })).toBe(false)
  expect(isOpenOptionsMessage({ type: "open-options" })).toBe(true)
  expect(isOpenOptionsMessage({ type: "open-options", url: "https://evil.example" })).toBe(false)
})
