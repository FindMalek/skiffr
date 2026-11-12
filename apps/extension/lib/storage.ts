import { type ExtensionSettings, extensionSettingsSchema } from "@skiffr/common"
import { browser } from "wxt/browser"

export const DEFAULT_SETTINGS: ExtensionSettings = { apiUrl: "http://localhost:3001", token: "" }

const SETTINGS_KEY = "settings"

type StorageArea = Pick<typeof browser.storage.local, "get" | "set">

export async function getSettings(area: StorageArea = browser.storage.local): Promise<ExtensionSettings> {
  const stored = await area.get(SETTINGS_KEY)
  const parsed = extensionSettingsSchema.safeParse(stored[SETTINGS_KEY])
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

export async function setSettings(
  settings: ExtensionSettings,
  area: StorageArea = browser.storage.local,
): Promise<ExtensionSettings> {
  const parsed = extensionSettingsSchema.parse(settings)
  await area.set({ [SETTINGS_KEY]: parsed })
  return parsed
}

const DISABLED_SITES_KEY = "disabledSites"
const NO_NEXT_SITES_KEY = "noNextJobSites"

async function readSites(key: string, area: StorageArea): Promise<string[]> {
  const stored = await area.get(key)
  const value = stored[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

async function addSite(key: string, hostname: string, area: StorageArea): Promise<void> {
  const sites = await readSites(key, area)
  const host = hostname.toLowerCase()
  if (!host || sites.includes(host)) return
  await area.set({ [key]: [...sites, host] })
}

export const getDisabledSites = (area: StorageArea = browser.storage.local): Promise<string[]> =>
  readSites(DISABLED_SITES_KEY, area)

export const disableSite = (hostname: string, area: StorageArea = browser.storage.local): Promise<void> =>
  addSite(DISABLED_SITES_KEY, hostname, area)

/** Sites where the person said "don't ask on this site" to the next job offer. The autofill question is a separate list. */
export const getNoNextJobSites = (area: StorageArea = browser.storage.local): Promise<string[]> =>
  readSites(NO_NEXT_SITES_KEY, area)

export const disableNextJobOffers = (hostname: string, area: StorageArea = browser.storage.local): Promise<void> =>
  addSite(NO_NEXT_SITES_KEY, hostname, area)
