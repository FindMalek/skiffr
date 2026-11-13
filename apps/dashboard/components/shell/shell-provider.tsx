"use client"

import { SidebarProvider } from "@skiffr/ui/components/sidebar"
import { createContext, useContext, useState, useSyncExternalStore } from "react"

const XL = "(min-width: 1280px)"

function subscribeXl(onChange: () => void): () => void {
  const query = window.matchMedia(XL)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/** True from `xl`. Only the trigger's state and label read it: the layout itself is decided by CSS. */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeXl,
    () => window.matchMedia(XL).matches,
    () => true,
  )
}

export type SidebarPin = "full" | "rail" | null

const PinContext = createContext<SidebarPin>(null)

/** What the user chose with the trigger, `null` while they have not (then the breakpoint decides). */
export function useSidebarPin(): SidebarPin {
  return useContext(PinContext)
}

/**
 * Icon rail from `md`, full sidebar from `xl`, decided by CSS so the first paint is already right (no layout shift
 * on hydration). The trigger pins one of the two until the window crosses `xl` again; only then does JS change it.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const wide = useWide()
  const [choice, setChoice] = useState<{ wide: boolean; pin: "full" | "rail" } | null>(null)
  const pin = choice && choice.wide === wide ? choice.pin : null
  const expanded = pin ? pin === "full" : wide
  return (
    <PinContext.Provider value={pin}>
      <SidebarProvider open={expanded} onOpenChange={(next) => setChoice({ wide, pin: next ? "full" : "rail" })}>
        {children}
      </SidebarProvider>
    </PinContext.Provider>
  )
}
