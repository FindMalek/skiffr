import { expect, test } from "bun:test"
import { buildScenario } from "./scenario"

const { users } = buildScenario(new Date("2026-10-17T10:00:00Z"))

test("covers admins, banned and unverified users", () => {
  expect(users.some((u) => u.role === "admin")).toBe(true)
  expect(users.some((u) => u.banned)).toBe(true)
  expect(users.some((u) => !u.emailVerified)).toBe(true)
})
