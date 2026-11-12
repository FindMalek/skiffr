import { expect, test } from "bun:test"
import {
  applicationSubmittedMessageSchema,
  isChildFormsGoneMessage,
  isFillMessage,
  isFillReportMessage,
  isFormDetectedMessage,
  isFrameNavigatedMessage,
  isNextOfferMessage,
  isOpenOptionsMessage,
  isReportAgainMessage,
  isTestConnectionMessage,
  nextDecisionMessageSchema,
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
  expect(isFillReportMessage({ type: "fill-report", filled: 2, review: 1, suggested: 0 })).toBe(true)
  expect(isFillReportMessage({ type: "fill-report", filled: 2, review: 1, suggested: 0, problem: "rejected" })).toBe(
    true,
  )
  expect(isFillReportMessage({ type: "fill-report", filled: -1, review: 0, suggested: 0 })).toBe(false)
  expect(isFillReportMessage({ type: "fill-report", filled: 1, review: 0, suggested: 0, problem: "<script>" })).toBe(
    false,
  )
  expect(isFillReportMessage({ type: "fill-report", filled: 1, review: 0, suggested: 0, label: "Salary" })).toBe(false)
  expect(isOpenOptionsMessage({ type: "open-options" })).toBe(true)
  expect(isOpenOptionsMessage({ type: "open-options", url: "https://evil.example" })).toBe(false)
})

test("next job messages are strict", () => {
  const id = "0b5c7a62-3f0e-4c0e-9a39-0d2e8a3f2f11"
  const brief = { title: "Engineer", company: "Acme" }
  expect(
    applicationSubmittedMessageSchema.safeParse({ type: "application-submitted", siteKey: "a.example" }).success,
  ).toBe(true)
  expect(
    applicationSubmittedMessageSchema.safeParse({ type: "application-submitted", siteKey: "a.example", url: "x" })
      .success,
  ).toBe(false)
  expect(isNextOfferMessage({ type: "next-offer", offerId: id, scope: "a.example", matched: null, next: brief })).toBe(
    true,
  )
  expect(
    isNextOfferMessage({
      type: "next-offer",
      offerId: id,
      matched: null,
      next: { ...brief, url: "https://x.example" },
    }),
  ).toBe(false)
  expect(isNextOfferMessage({ type: "next-offer", offerId: "nope", matched: null, next: brief })).toBe(false)
  expect(nextDecisionMessageSchema.safeParse({ type: "next-decision", offerId: id, action: "open" }).success).toBe(true)
  expect(nextDecisionMessageSchema.safeParse({ type: "next-decision", offerId: id, action: "open-url" }).success).toBe(
    false,
  )
  expect(
    nextDecisionMessageSchema.safeParse({ type: "next-decision", offerId: id, action: "mark", jobId: id }).success,
  ).toBe(false)
})
