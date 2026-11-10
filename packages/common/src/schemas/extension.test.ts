import { expect, test } from "bun:test"
import { extensionSettingsSchema } from "./extension"

const parses = (apiUrl: string) => extensionSettingsSchema.safeParse({ apiUrl, token: "" }).success

test("api url must be http or https", () => {
  for (const apiUrl of ["javascript:alert(1)", "chrome://extensions", "ftp://x.y"]) expect(parses(apiUrl)).toBe(false)
})

test("the token only travels over https, or http to this machine", () => {
  for (const apiUrl of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001", "https://example.com"]) {
    expect(parses(apiUrl), apiUrl).toBe(true)
  }
  for (const apiUrl of ["http://example.com", "http://localhost.evil.dev", "http://127.0.0.1.evil.dev:3001"]) {
    expect(parses(apiUrl), apiUrl).toBe(false)
  }
})
