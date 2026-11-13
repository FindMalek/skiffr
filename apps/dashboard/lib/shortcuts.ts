import { isTypingTarget } from "@skiffr/ui/lib/typing-target"

/** How long a sequence (`g` then `q`) waits for its next key before it is dropped. */
export const SEQUENCE_TIMEOUT_MS = 1500

/** `page`: focus is anywhere inside `main`. `list`: focus is inside an element marked `data-shortcuts-list`. */
export type ShortcutScope = "page" | "list"

export interface Shortcut {
  /** Stable name, e.g. `go-queue`. */
  id: string
  /** One key (`["?"]`) or a sequence (`["g", "q"]`). Letters are lower case, others are `KeyboardEvent.key` values. */
  keys: readonly string[]
  label: string
  /** The heading it has in the help dialog. */
  group: string
  scope?: ShortcutScope
  run: () => void
}

export interface PendingSequence {
  typed: readonly string[]
  /** The shortcuts that can still complete it. */
  next: readonly Shortcut[]
}

export interface Shortcuts {
  /** Returns the undo. A later registration of the same keys wins until it is undone. */
  register(shortcut: Shortcut): () => void
  handle(event: KeyboardEvent): void
  subscribe(listener: () => void): () => void
  list(): readonly Shortcut[]
  pending(): PendingSequence | null
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Dead"])
const LETTER = /^[a-z]$/i

/** `null` for a press that is not a shortcut key (a lone modifier, a letter with Shift held). */
function normalize(event: KeyboardEvent): string | null {
  const { key } = event
  if (MODIFIER_KEYS.has(key)) return null
  if (key === " ") return "Space"
  if (LETTER.test(key)) return event.shiftKey ? null : key.toLowerCase()
  return key
}

/** A dialog or menu is open: the page behind it is not the one being used. */
const overlayOpen = (): boolean =>
  document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null

function inScope(scope: ShortcutScope, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const main = document.getElementById("main")
  if (!main?.contains(target)) return false
  return scope === "page" || target.closest("[data-shortcuts-list]") !== null
}

/**
 * The one registry. It holds what pages registered, owns the sequence state and decides, for each key press, whether a
 * shortcut fires. `isEnabled` is read on every press (the Appearance switch), so turning shortcuts off needs no
 * re-registration. Modified keys (`Cmd/Ctrl K`, `Ctrl B`) never come through here.
 */
export function createShortcuts({
  isEnabled,
  timeoutMs = SEQUENCE_TIMEOUT_MS,
}: {
  isEnabled: () => boolean
  timeoutMs?: number
}): Shortcuts {
  const registered: { token: symbol; shortcut: Shortcut }[] = []
  const listeners = new Set<() => void>()
  let snapshot: readonly Shortcut[] = []
  let pending: PendingSequence | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const notify = () => {
    for (const listener of listeners) listener()
  }
  const setPending = (next: PendingSequence | null) => {
    clearTimeout(timer)
    timer = undefined
    if (next) {
      timer = setTimeout(() => {
        timer = undefined
        pending = null
        notify()
      }, timeoutMs)
    }
    if (pending === null && next === null) return
    pending = next
    notify()
  }

  return {
    register(shortcut) {
      const token = Symbol(shortcut.id)
      registered.push({ token, shortcut })
      snapshot = registered.map((entry) => entry.shortcut)
      notify()
      return () => {
        const index = registered.findIndex((entry) => entry.token === token)
        if (index === -1) return
        registered.splice(index, 1)
        snapshot = registered.map((entry) => entry.shortcut)
        // A sequence that was waiting on this shortcut has nothing left to complete.
        if (pending?.next.includes(shortcut)) setPending(null)
        notify()
      }
    },

    handle(event) {
      if (event.defaultPrevented || event.isComposing) return
      if (!isEnabled() || event.ctrlKey || event.metaKey || event.altKey) return setPending(null)
      const key = normalize(event)
      if (key === null || event.repeat) return
      if (isTypingTarget(event.target) || overlayOpen()) return setPending(null)

      const typed = [...(pending?.typed ?? []), key]
      // Latest registration first, so a page can override a pair of keys the shell registered.
      const candidates = registered
        .map((entry) => entry.shortcut)
        .reverse()
        .filter(
          (shortcut) =>
            shortcut.keys.length >= typed.length &&
            typed.every((typedKey, index) => shortcut.keys[index] === typedKey) &&
            inScope(shortcut.scope ?? "page", event.target),
        )
      const exact = candidates.find((shortcut) => shortcut.keys.length === typed.length)
      if (exact) {
        event.preventDefault()
        setPending(null)
        exact.run()
        return
      }
      if (candidates.length > 0) {
        event.preventDefault()
        setPending({ typed, next: candidates })
        return
      }
      setPending(null)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    list: () => snapshot,
    pending: () => pending,
  }
}

const KEY_LABELS: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }

/** What a key looks like in a hint. */
export const keyLabel = (key: string): string => KEY_LABELS[key] ?? key
