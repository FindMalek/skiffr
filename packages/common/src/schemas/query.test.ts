import { expect, test } from "bun:test"
import { siteProfilesInputSchema } from "./learning"
import { pageSchema } from "./page"

const limit = (value: unknown) => pageSchema.safeParse({ limit: value })
const offset = (value: unknown) => pageSchema.safeParse({ offset: value })

test("a query string digit or a number is a number, nothing else is", () => {
  for (const value of ["5", 5]) {
    expect(limit(value)).toMatchObject({ success: true, data: { limit: 5 } })
    expect(offset(value)).toMatchObject({ success: true, data: { offset: 5 } })
    expect(siteProfilesInputSchema.safeParse({ limit: value })).toMatchObject({ success: true, data: { limit: 5 } })
  }
  for (const value of ["", null, [], true, -1, "-1", 1.5, "1.5", "abc", "1e9", " 5", "0x10"]) {
    expect(limit(value).success, String(value)).toBe(false)
    expect(offset(value).success, String(value)).toBe(false)
    expect(siteProfilesInputSchema.safeParse({ limit: value }).success, String(value)).toBe(false)
  }
  expect(pageSchema.parse({})).toMatchObject({ offset: 0 })
})
