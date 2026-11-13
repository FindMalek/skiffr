"use client"

import { SidebarProvider } from "@skiffr/ui/components/sidebar"
import { useState, useSyncExternalStore } from "react"

const XL = "(min-width: 1280px)"

function subscribeXl(onChange: () => void): () => void {
  const query = window.matchMedia(XL)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/** True from `xl`. The server and the first client render assume it, the full sidebar being the common case. */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeXl,
    () => window.matchMedia(XL).matches,
    () => true,
  )
}

/**
 * Icon rail from `md`, full sidebar from `xl`. The trigger overrides that until the window crosses `xl` again, so a
 * resize never leaves the sidebar in a state the user did not ask for at the new width.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const wide = useWide()
  const [choice, setChoice] = useState<{ wide: boolean; open: boolean } | null>(null)
  const open = choice && choice.wide === wide ? choice.open : wide
  return (
    <SidebarProvider open={open} onOpenChange={(next) => setChoice({ wide, open: next })}>
      {children}
    </SidebarProvider>
  )
}
