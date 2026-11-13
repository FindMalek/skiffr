import { afterEach, expect, test } from "bun:test"
import { readShortcutsEnabled, SHORTCUTS_STORAGE_KEY, writeShortcutsEnabled } from "./shortcuts-setting"

const real = Object.getOwnPropertyDescriptor(window, "localStorage")

/** A storage whose reads work (or throw) and whose writes always throw, as in a full or private-mode browser. */
function refuseWrites(stored: Record<string, string>, readable = true) {
  const store = {
    getItem: (key: string) => {
      if (!readable) throw new Error("blocked")
      return stored[key] ?? null
    },
    setItem: () => {
      throw new Error("quota")
    },
  }
  Object.defineProperty(window, "localStorage", { value: store, configurable: true })
  return stored
}

afterEach(() => {
  if (real) Object.defineProperty(window, "localStorage", real)
  window.localStorage.clear()
  writeShortcutsEnabled(true)
  window.localStorage.clear()
})

test("shortcuts are on until the user turns them off, and the choice is stored per browser", () => {
  expect(readShortcutsEnabled()).toBe(true)
  writeShortcutsEnabled(false)
  expect(window.localStorage.getItem(SHORTCUTS_STORAGE_KEY)).toBe("off")
  expect(readShortcutsEnabled()).toBe(false)
  writeShortcutsEnabled(true)
  expect(readShortcutsEnabled()).toBe(true)
})

test("a stored value that is not on or off counts as on", () => {
  window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, "garbage")
  expect(readShortcutsEnabled()).toBe(true)
})

test("storage that cannot be read or written still lets the switch work for the page", () => {
  refuseWrites({}, false)
  expect(readShortcutsEnabled()).toBe(true)
  writeShortcutsEnabled(false)
  expect(readShortcutsEnabled()).toBe(false)
})

test("a refused write wins over the old stored value that can still be read", () => {
  const stored = refuseWrites({ [SHORTCUTS_STORAGE_KEY]: "on" })
  writeShortcutsEnabled(false)
  expect(readShortcutsEnabled()).toBe(false)
  stored[SHORTCUTS_STORAGE_KEY] = "on"
  expect(readShortcutsEnabled()).toBe(false)
})

test("a refused write is dropped once another tab or devtools changes or clears the key", () => {
  const stored = refuseWrites({ [SHORTCUTS_STORAGE_KEY]: "on" })
  writeShortcutsEnabled(false)
  delete stored[SHORTCUTS_STORAGE_KEY]
  expect(readShortcutsEnabled()).toBe(true)
  stored[SHORTCUTS_STORAGE_KEY] = "off"
  expect(readShortcutsEnabled()).toBe(false)
})

test("a cleared key reads as the default after a write that worked", () => {
  writeShortcutsEnabled(false)
  window.localStorage.removeItem(SHORTCUTS_STORAGE_KEY)
  expect(readShortcutsEnabled()).toBe(true)
})
