"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

const SETTLE_MS = 1500

/**
 * On a route change focus moves to the page `h1`, so a screen reader announces the new page and the next Tab starts
 * at its content. The h1 of a loading skeleton is replaced when the page streams in; while focus is lost to the body
 * it is moved again, but never taken from something the user focused in the meantime. The first load keeps the
 * browser's own focus.
 */
export function RouteFocus() {
  const pathname = usePathname()
  const previous = useRef(pathname)

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    const main = document.getElementById("main")
    if (!main) return
    const focusTitle = () => (main.querySelector<HTMLElement>("h1") ?? main).focus({ preventScroll: true })
    const lost = () => {
      const active = document.activeElement
      return !active || active === document.body || active === main
    }
    focusTitle()
    const observer = new MutationObserver(() => {
      if (lost()) focusTitle()
    })
    observer.observe(main, { childList: true, subtree: true })
    const timer = setTimeout(() => observer.disconnect(), SETTLE_MS)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [pathname])

  return null
}
