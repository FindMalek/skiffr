import { useSyncExternalStore } from "react"

/** Settings > Appearance > Keyboard shortcuts. Per browser, on by default. Read by the shortcuts provider (WCAG 2.1.4). */
export const SHORTCUTS_STORAGE_KEY = "skiffr.shortcuts"

const CHANGE_EVENT = "skiffr:shortcuts"

/** Used when storage is blocked or full, so the switch still works for the page's lifetime. */
let fallback: boolean | null = null

export function readShortcutsEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY)
    if (stored === "off") return false
    if (stored === "on") return true
  } catch {
    // blocked storage: use what this page was told
  }
  return fallback ?? true
}

export function writeShortcutsEnabled(enabled: boolean): void {
  fallback = enabled
  try {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, enabled ? "on" : "off")
  } catch {
    // kept in `fallback`
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
