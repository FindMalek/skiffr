import { expect, test } from "bun:test"
import { DEFAULT_SETTINGS, getSettings, setSettings } from "./storage"

function fakeArea(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  return {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items)
    },
  } as Parameters<typeof getSettings>[0]
}

test("settings round trip with a trimmed api url", async () => {
  const area = fakeArea()
  await setSettings({ apiUrl: "https://api.skiffr.dev///", token: " abc " }, area)
  expect(await getSettings(area)).toEqual({ apiUrl: "https://api.skiffr.dev", token: "abc" })
})

test("bad stored settings fall back to defaults", async () => {
  expect(await getSettings(fakeArea({ settings: { apiUrl: "nope" } }))).toEqual(DEFAULT_SETTINGS)
})
