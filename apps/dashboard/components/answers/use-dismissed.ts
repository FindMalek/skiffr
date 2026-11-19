"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"
import { DISMISSED_MAX, parseDismissed } from "@/lib/answers"

/** Keys of the "make this your default?" cards this browser dismissed. The Today count reads the same key. */
export const DISMISSED_STORAGE_KEY = "skiffr:answers:dismissed"
const listeners = new Set<() => void>()

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

/** Dismissing a "make this your default?" card has no server side: it hides the card in this browser while the answer keeps its value. */
export function useDismissed() {
  const raw = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    readDismissed,
    () => "[]",
  )
  const dismiss = useCallback((key: string) => {
    try {
      const next = [...parseDismissed(readDismissed()), key].slice(-DISMISSED_MAX)
      localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // storage blocked: the card comes back on the next visit
    }
    for (const listener of listeners) listener()
  }, [])
  const dismissed = useMemo(() => new Set(parseDismissed(raw)), [raw])
  return { dismissed, dismiss }
}
