"use client"

import { useCallback } from "react"

/**
 * A sticky bottom action (a save bar) tells the shell how tall it is by setting `--action-bar-h`, so the toasts sit
 * above it on a phone. Attach the returned ref to the bar: the height is measured (it changes as the bar wraps) and
 * the variable goes back to its default when the bar unmounts. A bar that sits in the page flow should also take
 * `max-md:mb-[calc(var(--action-bar-h)*-1)]`, because the shell already pads the page by this height for fixed bars.
 */
export function useActionBar(): (element: HTMLElement | null) => (() => void) | undefined {
  return useCallback((element) => {
    if (!element) return
    const root = document.documentElement
    const measure = () =>
      root.style.setProperty("--action-bar-h", `${Math.ceil(element.getBoundingClientRect().height)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.style.removeProperty("--action-bar-h")
    }
  }, [])
}
