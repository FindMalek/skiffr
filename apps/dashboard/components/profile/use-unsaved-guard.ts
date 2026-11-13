"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { holdNavigation } from "@/lib/navigation-guard"

/** A link click that opens the same site in this tab. Modified clicks and new-tab links are left alone. */
function internalHref(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return null
  const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return null
  const url = new URL(link.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Warns before the page is left with unsaved edits: the browser's own prompt for reload, close and external links
 * (`beforeunload`), and `pending` for in-app navigation, so the page can show its own dialog. A link click is caught
 * directly; code that calls `router.push` itself asks `mayNavigate` first (the mobile settings select does). Cancelling
 * a `router.push` after the fact is not possible: the router has already moved. `leave` goes on without asking again.
 */
export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const bypass = useRef(false)

  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    const click = (event: MouseEvent) => {
      if (bypass.current) return
      const href = internalHref(event)
      if (!href) return
      event.preventDefault()
      event.stopPropagation()
      setPending(href)
    }
    window.addEventListener("beforeunload", beforeUnload)
    document.addEventListener("click", click, true)
    const release = holdNavigation((href) => {
      if (bypass.current) return true
      setPending(href)
      return false
    })
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      document.removeEventListener("click", click, true)
      release()
    }
  }, [dirty])

  const stay = useCallback(() => setPending(null), [])
  const leave = useCallback(() => {
    if (pending === null) return
    bypass.current = true
    setPending(null)
    router.push(pending as never)
  }, [pending, router])

  return { pending, stay, leave }
}
