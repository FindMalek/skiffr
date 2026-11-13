"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

const FIND_MS = 1500
/** A slow page can keep its skeleton for a long time: keep watching for the real title, but not forever. */
const TITLE_MS = 10_000

const lost = (main: HTMLElement) => {
  const active = document.activeElement
  return !active || active === document.body || active === main
}

/** Calls `onAct` on the first key or pointer press: from then on the user is in charge of focus. Returns the undo. */
function onUserAction(onAct: () => void): () => void {
  const events = ["keydown", "pointerdown"] as const
  for (const type of events) document.addEventListener(type, onAct, true)
  return () => {
    for (const type of events) document.removeEventListener(type, onAct, true)
  }
}

/**
 * Moves focus to the page `h1` (or `main`) and keeps doing so while focus is lost to the body, for up to 10 seconds
 * or until the user presses a key or the pointer: the h1 of a loading skeleton, or of an error box the user just
 * retried, is replaced when the next content arrives. Focus the user put somewhere else is never taken. Returns a
 * cleanup.
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
  const stopListening = onUserAction(stop)
  const timer = setTimeout(stop, TITLE_MS)
  function stop() {
    observer.disconnect()
    stopListening()
    clearTimeout(timer)
  }
  return stop
}

/**
 * Focuses the first visible element matching `selector` once it exists, unless the user pressed a key or the pointer
 * since the call. The first 300ms are skipped so a closing dialog's own focus return (and the route's title focus)
 * happen first and this one wins.
 */
export function focusWhenReady(selector: string): () => void {
  let ticks = 0
  const stopListening = onUserAction(stop)
  const timer = setInterval(() => {
    ticks += 1
    if (ticks < 3) return
    const element = document.querySelector<HTMLElement>(selector)
    if (element && element.getClientRects().length > 0) {
      element.focus()
      stop()
    } else if (ticks > FIND_MS / 100) stop()
  }, 100)
  function stop() {
    clearInterval(timer)
    stopListening()
  }
  return stop
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
