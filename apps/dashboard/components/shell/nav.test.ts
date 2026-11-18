import { expect, test } from "bun:test"
import { ADMIN_NAV, isMoreActive, isNavActive, PRIMARY_NAV, SETTINGS_NAV } from "./nav"

const current = (pathname: string) =>
  [...PRIMARY_NAV, SETTINGS_NAV, ...ADMIN_NAV].filter((item) => isNavActive(item, pathname)).map((item) => item.label)

test("one item is current per route, and settings sub pages light only Settings", () => {
  expect(current("/")).toEqual(["Today"])
  expect(current("/queue")).toEqual(["Queue"])
  expect(current("/answers/anything")).toEqual(["Answers"])
  expect(current("/settings")).toEqual(["Settings"])
  expect(current("/settings/gmail")).toEqual(["Settings"])
  expect(current("/users")).toEqual(["Users"])
  expect(current("/settings/elsewhere")).toEqual([])
  expect(current("/queuefoo")).toEqual([])
  expect(current("/answers-old")).toEqual([])
  expect(current("/queue/anything")).toEqual(["Queue"])
})

test("the More tab is current for settings and admin pages only", () => {
  expect(isMoreActive("/settings/cv")).toBe(true)
  expect(isMoreActive("/users")).toBe(true)
  expect(isMoreActive("/queue")).toBe(false)
})
