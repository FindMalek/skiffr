import { useSyncExternalStore } from "react"

/** Settings > Appearance > Keyboard shortcuts. Per browser, on by default. Read by the shortcuts provider (WCAG 2.1.4). */
export const SHORTCUTS_STORAGE_KEY = "skiffr.shortcuts"

const CHANGE_EVENT = "skiffr:shortcuts"

/**
 * The last write that storage refused (full, blocked). It wins for the page's lifetime, until storage shows a value
 * other than the one it held at that moment (another tab or devtools changed or cleared the key).
 * `raw` is undefined when storage could not even be read.
 */
let refused: { value: boolean; raw: string | null | undefined } | null = null

function readRaw(): string | null | undefined {
  try {
    return window.localStorage.getItem(SHORTCUTS_STORAGE_KEY)
  } catch {
    return undefined
  }
}

export function readShortcutsEnabled(): boolean {
  const raw = readRaw()
  if (refused) {
    if (raw === undefined || raw === refused.raw) return refused.value
    refused = null
  }
  return raw !== "off"
}

export function writeShortcutsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, enabled ? "on" : "off")
    refused = null
  } catch {
    refused = { value: enabled, raw: readRaw() }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHORTCUTS_STORAGE_KEY) onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onStorage)
  }
}

/** True on the server and until the browser value is read, so the first paint matches the default. */
export function useShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, readShortcutsEnabled, () => true)
}
