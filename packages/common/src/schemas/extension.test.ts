import { expect, test } from "bun:test"
import { extensionSettingsSchema } from "./extension"

test("api url must be http or https", () => {
  for (const apiUrl of ["javascript:alert(1)", "chrome://extensions", "ftp://x.y"]) {
    expect(extensionSettingsSchema.safeParse({ apiUrl, token: "" }).success).toBe(false)
  }
  for (const apiUrl of ["http://localhost:3001", "https://api.skiffr.dev"]) {
    expect(extensionSettingsSchema.safeParse({ apiUrl, token: "" }).success).toBe(true)
  }
})
