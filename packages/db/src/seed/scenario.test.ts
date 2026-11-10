import { expect, test } from "bun:test"
import { buildScenario } from "./scenario"

const { users, notes } = buildScenario(new Date("2026-10-17T10:00:00Z"), { ownerId: "owner" })

test("covers admins, banned and unverified users", () => {
  expect(users.some((u) => u.role === "admin")).toBe(true)
  expect(users.some((u) => u.banned)).toBe(true)
  expect(users.some((u) => !u.emailVerified)).toBe(true)
})

test("the seeded owner gets notes, pinned and not", () => {
  const own = notes.filter((n) => n.userId === "owner")
  expect(own.some((n) => n.pinned)).toBe(true)
  expect(own.some((n) => !n.pinned)).toBe(true)
})
