import { expect, test } from "bun:test"
import {
  DEFAULT_SETTINGS,
  disableNextJobOffers,
  disableSite,
  getDisabledSites,
  getNoNextJobSites,
  getSettings,
  setSettings,
} from "./storage"

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

test("disabled sites are stored once per lowercase hostname", async () => {
  const area = fakeArea()
  await disableSite("Jobs.Example.com", area)
  await disableSite("jobs.example.com", area)
  expect(await getDisabledSites(area)).toEqual(["jobs.example.com"])
})

test("muting the next job offer does not disable autofill on the site", async () => {
  const area = fakeArea()
  await disableNextJobOffers("Jobs.Example.com", area)
  expect(await getNoNextJobSites(area)).toEqual(["jobs.example.com"])
  expect(await getDisabledSites(area)).toEqual([])
})
