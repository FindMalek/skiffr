"use client"

import { Kbd } from "@skiffr/ui/components/kbd"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import {
  createContext,
  Fragment,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { mayNavigate } from "@/lib/navigation-guard"
import { createShortcuts, keyLabel, type Shortcut, type Shortcuts } from "@/lib/shortcuts"
import { readShortcutsEnabled, useShortcutsEnabled } from "@/lib/shortcuts-setting"

const ShortcutsHelp = lazy(() => import("./shortcuts-help").then((module) => ({ default: module.ShortcutsHelp })))

type ShortcutsContextValue = { shortcuts: Shortcuts; openHelp: () => void }

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null)

function useShortcutsContext(): ShortcutsContextValue {
  const context = useContext(ShortcutsContext)
  if (!context) throw new Error("Shortcuts hooks must be used within a ShortcutsProvider.")
  return context
}

/** Opens the `?` help dialog. It is also the user menu's "Keyboard shortcuts", so it works with shortcuts off. */
export function useShortcutsHelp(): { open: () => void } {
  const { openHelp } = useShortcutsContext()
  return useMemo(() => ({ open: openHelp }), [openHelp])
}

/** What is registered right now, in registration order. Re-renders when a page registers or unregisters. */
export function useRegisteredShortcuts(): readonly Shortcut[] {
  const { shortcuts } = useShortcutsContext()
  return useSyncExternalStore(shortcuts.subscribe, shortcuts.list, () => [])
}

/**
 * Registers one shortcut while the component is mounted (DESIGN.md 3.2). The shortcut never fires from a text field,
 * with a modifier held, behind an open dialog, outside `main` (or outside a `data-shortcuts-list` for scope `list`),
 * or when the user turned single key shortcuts off. It must also exist as a visible control: it is an accelerator.
 */
export function useShortcut(shortcut: Shortcut & { enabled?: boolean }): void {
  const { shortcuts } = useShortcutsContext()
  const run = useRef(shortcut.run)
  useEffect(() => {
    run.current = shortcut.run
  })
  const { id, label, group, scope, priority, enabled = true } = shortcut
  const keys = shortcut.keys.join("\n")
  useEffect(() => {
    if (!enabled) return
    return shortcuts.register({ id, keys: keys.split("\n"), label, group, scope, priority, run: () => run.current() })
  }, [shortcuts, id, keys, label, group, scope, priority, enabled])
}

/** `g then q`: one `kbd` per key. The word between them is text, so a screen reader reads the order. */
export function ShortcutKeys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="text-muted-foreground text-xs">then</span>}
          <Kbd>{keyLabel(key)}</Kbd>
        </Fragment>
      ))}
    </span>
  )
}

/** Below a page's own shortcuts: a page may take over a pair of keys, whichever of them mounted first. */
const SHELL_PRIORITY = -1

const GO_TO: { key: string; label: string; href: Route }[] = [
  { key: "h", label: "Today", href: "/" },
  { key: "q", label: "Queue", href: "/queue" },
  { key: "a", label: "Answers", href: "/answers" },
  { key: "s", label: "Stats", href: "/stats" },
  { key: ",", label: "Settings", href: "/settings/account" },
]

function GoTo({ target }: { target: (typeof GO_TO)[number] }) {
  const router = useRouter()
  useShortcut({
    id: `go-${target.label.toLowerCase()}`,
    keys: ["g", target.key],
    label: target.label,
    group: "Go to",
    priority: SHELL_PRIORITY,
    run: () => {
      if (mayNavigate(target.href)) router.push(target.href)
    },
  })
  return null
}

/** The shell's own shortcuts: the help dialog and go to. Each also exists as a visible control and in the palette. */
function ShellShortcuts({ openHelp }: { openHelp: () => void }) {
  useShortcut({
    id: "help",
    keys: ["?"],
    label: "Show this list",
    group: "On the page",
    priority: SHELL_PRIORITY,
    run: openHelp,
  })
  return GO_TO.map((target) => <GoTo key={target.key} target={target} />)
}

/** Shows the keys that can finish a sequence in progress. The region exists all the time so the first one is announced. */
function PendingSequence() {
  const { shortcuts } = useShortcutsContext()
  const pending = useSyncExternalStore(shortcuts.subscribe, shortcuts.pending, () => null)
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-(--toast-bottom) left-1/2 z-toast max-w-11/12 -translate-x-1/2"
    >
      {pending && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-border-strong bg-popover px-3 py-2 text-popover-foreground text-sm">
          <ShortcutKeys keys={pending.typed} />
          <span className="text-muted-foreground">then</span>
          {pending.next.map((shortcut) => (
            <span key={shortcut.id} className="inline-flex items-center gap-1.5">
              <Kbd>{keyLabel(shortcut.keys[pending.typed.length] ?? "")}</Kbd>
              {shortcut.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The one shortcuts registry (DESIGN.md 3.2) and its `keydown` listener. Single keys are decided by `createShortcuts`;
 * `Cmd/Ctrl K` (palette) and `Ctrl B` (sidebar) are modified keys with their own listeners and are not handled here.
 * The help dialog is a separate chunk that is only requested the first time it opens.
 */
export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [shortcuts] = useState(() => createShortcuts({ isEnabled: readShortcutsEnabled }))
  const [help, setHelp] = useState({ requested: false, open: false })
  const value = useMemo(() => ({ shortcuts, openHelp: () => setHelp({ requested: true, open: true }) }), [shortcuts])

  useEffect(() => {
    document.addEventListener("keydown", shortcuts.handle)
    document.addEventListener("focusout", shortcuts.focusOut)
    return () => {
      document.removeEventListener("keydown", shortcuts.handle)
      document.removeEventListener("focusout", shortcuts.focusOut)
    }
  }, [shortcuts])

  // Turning the switch off (here or in another tab) ends a sequence that is waiting for its last key.
  const enabled = useShortcutsEnabled()
  useEffect(() => {
    if (!enabled) shortcuts.cancel()
  }, [shortcuts, enabled])

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      <ShellShortcuts openHelp={value.openHelp} />
      <PendingSequence />
      {help.requested && (
        <Suspense fallback={null}>
          <ShortcutsHelp open={help.open} onOpenChange={(open) => setHelp((current) => ({ ...current, open }))} />
        </Suspense>
      )}
    </ShortcutsContext.Provider>
  )
}
