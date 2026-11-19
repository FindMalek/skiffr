"use client"

import { Button } from "@skiffr/ui/components/button"
import { Kbd } from "@skiffr/ui/components/kbd"
import { SearchIcon } from "lucide-react"
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

const CommandPalette = lazy(() => import("./command-palette").then((module) => ({ default: module.CommandPalette })))

type PaletteContextValue = { open: () => void }

const PaletteContext = createContext<PaletteContextValue | null>(null)

export function usePalette(): PaletteContextValue {
  const context = useContext(PaletteContext)
  if (!context) throw new Error("usePalette must be used within a PaletteProvider.")
  return context
}

/**
 * Owns the open state and the global `Cmd/Ctrl K` (a modified key, so it may fire from anywhere). The palette itself
 * is a separate chunk that is only requested the first time it opens.
 */
export function PaletteProvider({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [requested, setRequested] = useState(false)
  const show = useCallback((next: boolean) => {
    if (next) setRequested(true)
    setOpen(next)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return
      if (!(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setRequested(true)
      setOpen((current) => !current)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const value = useMemo(() => ({ open: () => show(true) }), [show])
  return (
    <PaletteContext.Provider value={value}>
      {children}
      {requested && (
        <Suspense fallback={null}>
          <CommandPalette open={open} onOpenChange={show} isAdmin={isAdmin} />
        </Suspense>
      )}
    </PaletteContext.Provider>
  )
}

const noSubscription = () => () => {}

export function useIsApple(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  )
}

/** `Search  ⌘K` from `md`, a search icon below it. */
export function SearchButton() {
  const { open } = usePalette()
  const apple = useIsApple()
  return (
    <Button
      variant="outline"
      aria-keyshortcuts="Control+K Meta+K"
      onClick={open}
      className="max-md:size-(--control-h) max-md:px-0 md:w-56 md:justify-between md:text-muted-foreground"
    >
      <span className="flex items-center gap-2">
        <SearchIcon aria-hidden="true" />
        <span className="max-md:sr-only">Search</span>
      </span>
      <Kbd aria-hidden="true" className="max-md:hidden">
        {apple ? "⌘K" : "Ctrl K"}
      </Kbd>
    </Button>
  )
}
