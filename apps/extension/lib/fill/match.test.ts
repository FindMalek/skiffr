import { describe, expect, test } from "bun:test"
import { movedDialCode } from "./match"

describe("movedDialCode", () => {
  const kept: [string, string][] = [
    ["912 345 678", "+351 912 345 678"],
    ["5551234567", "+1 5551234567"],
    ["(555) 123-4567", "+1 555 123 4567"],
    ["98765 43210", "+91 98765 43210"],
    ["07911 123456", "+44 7911 123456"],
    ["0612345678", "+33 6 12 34 56 78"],
    ["9123456789", "+7 9123456789"],
    ["123456789", "+998 123456789"],
    ["0 612 3456", "+49 612 3456"],
    ["0171 1234567", "+49 171 1234567"],
    ["087 123 4567", "+353 87 123 4567"],
    ["09 1234 5678", "+358 9 1234 5678"],
  ]
  const rejected: [string, string, string][] = [
    ["551234567", "+1 5551234567", "two national digits cut"],
    ["876543210", "+91 98765 43210", "two national digits cut"],
    ["12 345 678", "+351 912 345 678", "a digit cut"],
    ["5 123", "+15 123", "fewer than five digits"],
    ["912 345 678", "351 912 345 678", "no plus: not an international number"],
    ["912 345 678", "00351 912 345 678", "no plus: not an international number"],
    ["+351 912 345 678", "+44 912 345 678", "another country"],
    ["0912 345 678", "+351 912 345 679", "another number"],
    ["00912345678", "+351 912 345 678", "two leading zeros"],
    ["0912 345 678", "+351 912 345 678", "portugal has no trunk 0"],
    ["0555 123 4567", "+1 555 123 4567", "north america has no trunk 0"],
    ["0612 345 678", "+34 612 345 678", "spain has no trunk 0"],
    ["", "+351 912 345 678", "empty"],
  ]
  test.each(kept)("%s is %s without its dial code", (shown, wanted) => {
    expect(movedDialCode(shown, wanted)).toBe(true)
  })
  test.each(rejected)("%s is not %s (%s)", (shown, wanted) => {
    expect(movedDialCode(shown, wanted)).toBe(false)
  })
})
