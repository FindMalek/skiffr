import { afterEach, expect, test } from "bun:test"
import { readShortcutsEnabled, SHORTCUTS_STORAGE_KEY, writeShortcutsEnabled } from "./shortcuts-setting"

afterEach(() => window.localStorage.clear())

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

test("blocked storage does not throw, and the switch still works for the page", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked")
    },
    setItem: () => {
      throw new Error("blocked")
    },
  }
  const real = Object.getOwnPropertyDescriptor(window, "localStorage")
  Object.defineProperty(window, "localStorage", { value: blocked, configurable: true })
  try {
    expect(readShortcutsEnabled()).toBe(true)
    writeShortcutsEnabled(false)
    expect(readShortcutsEnabled()).toBe(false)
  } finally {
    if (real) Object.defineProperty(window, "localStorage", real)
  }
})
