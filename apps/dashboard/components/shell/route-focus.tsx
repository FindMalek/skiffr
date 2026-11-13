"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

const SETTLE_MS = 1500

const lost = (main: HTMLElement) => {
  const active = document.activeElement
  return !active || active === document.body || active === main
}

/**
 * Moves focus to the page `h1` (or `main`) and keeps doing so while focus is lost to the body, for a moment: the h1 of
 * a loading skeleton, or of an error box the user just retried, is replaced when the next content arrives. Focus the
 * user put somewhere else meanwhile is never taken. Returns a cleanup.
 */
export function focusPageTitle(): () => void {
  const main = document.getElementById("main")
  if (!main) return () => {}
  const focusTitle = () => (main.querySelector<HTMLElement>("h1") ?? main).focus({ preventScroll: true })
  focusTitle()
  const observer = new MutationObserver(() => {
    if (lost(main)) focusTitle()
  })
  observer.observe(main, { childList: true, subtree: true })
  const timer = setTimeout(() => observer.disconnect(), SETTLE_MS)
  return () => {
    observer.disconnect()
    clearTimeout(timer)
  }
}

/**
 * Focuses the first visible element matching `selector` once it exists. The first 300ms are skipped so a closing
 * dialog's own focus return (and the route's title focus) happen first and this one wins.
 */
export function focusWhenReady(selector: string): () => void {
  let ticks = 0
  const timer = setInterval(() => {
    ticks += 1
    if (ticks < 3) return
    const element = document.querySelector<HTMLElement>(selector)
    if (element && element.getClientRects().length > 0) {
      element.focus()
      clearInterval(timer)
    } else if (ticks > SETTLE_MS / 100) clearInterval(timer)
  }, 100)
  return () => clearInterval(timer)
}

/**
 * On a route change focus moves to the page title, so a screen reader announces the new page and the next Tab starts
 * at its content. The first load keeps the browser's own focus.
 */
export function RouteFocus() {
  const pathname = usePathname()
  const previous = useRef(pathname)

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    return focusPageTitle()
  }, [pathname])

  return null
}
