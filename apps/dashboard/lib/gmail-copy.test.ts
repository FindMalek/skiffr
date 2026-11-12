import { expect, test } from "bun:test"
import { errorFor, noticeFor } from "./gmail-copy"

test("only known status words have a message, never an inherited property", () => {
  expect(noticeFor("connected")?.ok).toBe(true)
  for (const word of ["constructor", "__proto__", "toString", "nope", null])
    expect(noticeFor(word), String(word)).toBeUndefined()
  expect(errorFor("rate_limited")).toContain("slow down")
  for (const word of ["constructor", "__proto__", "toString", "nope", null])
    expect(errorFor(word), String(word)).toBe(errorFor("internal"))
})
