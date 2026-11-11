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

export async function getDisabledSites(area: StorageArea = browser.storage.local): Promise<string[]> {
  const stored = await area.get(DISABLED_SITES_KEY)
  const value = stored[DISABLED_SITES_KEY]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export async function disableSite(hostname: string, area: StorageArea = browser.storage.local): Promise<void> {
  const sites = await getDisabledSites(area)
  const host = hostname.toLowerCase()
  if (!host || sites.includes(host)) return
  await area.set({ [DISABLED_SITES_KEY]: [...sites, host] })
}
