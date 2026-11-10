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
