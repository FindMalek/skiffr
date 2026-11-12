import { expect, test } from "bun:test"
import { errorFor, kindLabel } from "./watch-copy"

test("only known codes have a message, never an inherited property", () => {
  expect(errorFor("blocked")).toContain("public")
  for (const word of ["constructor", "__proto__", "toString", "nope", null])
    expect(errorFor(word), String(word)).toBe(errorFor("internal"))
  expect(kindLabel("lever")).toBe("Lever")
  expect(kindLabel("constructor")).toBe("Web page")
})
