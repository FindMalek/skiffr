import { expect, test } from "bun:test"
import type { AdminUser } from "@skiffr/common/schemas"
import { filterUsers, limitSentence, userMarkers, usersSentence } from "./users"

const person = (name: string, over: Partial<AdminUser> = {}): AdminUser => ({
  id: name,
  name,
  email: `${name.toLowerCase()}@test.dev`,
  role: null,
  emailVerified: true,
  banned: false,
  createdAt: new Date(0),
  ...over,
})

test("search matches name or email, ignoring case and accents", () => {
  const rows = [person("Zoé", { email: "plain@test.dev" }), person("Ana", { email: "boss@corp.dev" }), person("Bo")]
  expect(filterUsers(rows, "zoe").map((r) => r.name)).toEqual(["Zoé"])
  expect(filterUsers(rows, " CORP ").map((r) => r.name)).toEqual(["Ana"])
  expect(filterUsers(rows, "").length).toBe(3)
  expect(filterUsers(rows, "nobody")).toEqual([])
})

test("banned and unverified are separate markers, a plain account has none", () => {
  expect(userMarkers(person("a"))).toEqual([])
  expect(userMarkers(person("b", { banned: true, emailVerified: false }))).toEqual(["banned", "unverified"])
  expect(userMarkers(person("c", { emailVerified: false }))).toEqual(["unverified"])
})

test("the page admits when the api holds more accounts than it returned", () => {
  expect(limitSentence(100, 100)).toBeNull()
  expect(limitSentence(100, 140)).toContain("100 newest of 140")
})

test("the live sentence names the page and range, and says when a search only covers the newest accounts", () => {
  const view = { filtered: 25, loaded: 30, page: 2, pages: 3, first: 11, last: 20 }
  expect(usersSentence(view, false)).toBe("Page 2 of 3, showing 11-20 of 25 users.")
  expect(usersSentence({ ...view, filtered: 0 }, true)).toBe("No users match. Only the newest accounts are searched.")
  expect(usersSentence({ ...view, filtered: 0 }, false)).toBe("No users match.")
})
