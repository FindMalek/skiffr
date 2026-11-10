import { expect, test } from "bun:test"
import { firstName } from "./index"

test("firstName takes the first word and survives odd spacing", () => {
  expect(firstName("  Ada  Lovelace ")).toBe("Ada")
  expect(firstName("")).toBe("")
})
