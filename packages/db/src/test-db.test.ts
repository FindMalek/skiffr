import { expect, test } from "bun:test"
import { assertTestUrl } from "./test-db"

test("only databases named skiffr_test* are accepted", () => {
  expect(() => assertTestUrl("postgres://skiffr:skiffr@localhost:5432/skiffr")).toThrow("skiffr_test")
  expect(() => assertTestUrl("postgres://skiffr:skiffr@localhost:5432/")).toThrow("skiffr_test")
  expect(assertTestUrl("postgres://skiffr:skiffr@localhost:5432/skiffr_test").pathname).toBe("/skiffr_test")
})
