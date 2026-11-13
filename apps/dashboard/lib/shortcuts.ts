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
  /** Higher wins when two shortcuts have the same keys, whatever mounted first. Default 0; the shell uses -1. Then the latest registration wins. */
  priority?: number
  run: () => void
}

export interface PendingSequence {
  typed: readonly string[]
  /** The shortcuts that can still complete it, one per pair of keys, in registration order. */
  next: readonly Shortcut[]
}

export interface Shortcuts {
  /** Returns the undo. A later registration of the same keys wins until it is undone. */
  register(shortcut: Shortcut): () => void
  handle(event: KeyboardEvent): void
  /** Drops a sequence in progress. */
  cancel(): void
  /** For `focusout`: a sequence in progress is dropped when focus does not stay inside `#main`. */
  focusOut(event: FocusEvent): void
  subscribe(listener: () => void): () => void
  /** Lowest precedence first, so the last one with a pair of keys is the one that fires. */
  list(): readonly Shortcut[]
  pending(): PendingSequence | null
}

const NON_SHORTCUT_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Process"])
/** Browsers report an IME keystroke as keyCode 229, some without `isComposing` (Safari after `compositionend`). */
const IME_KEY_CODE = 229
const LETTER = /^[a-z]$/i

/** `null` for a press that is not a shortcut key (a lone modifier, a letter with Shift held). */
function normalize(event: KeyboardEvent): string | null {
  const { key } = event
  if (NON_SHORTCUT_KEYS.has(key)) return null
  if (key === " ") return "Space"
  if (LETTER.test(key)) return event.shiftKey ? null : key.toLowerCase()
  return key
}

/** A dialog or menu is open: the page behind it is not the one being used. */
const overlayOpen = (): boolean =>
  document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null

function inScope(scope: ShortcutScope, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  // Nothing focused (a fresh load, a removed element) is the page: the keys must work before the first click.
  if (scope === "page" && (target === document.body || target === document.documentElement)) return true
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

  const sync = () => {
    // Stable: equal priorities keep registration order, so the latest registration wins among them.
    snapshot = registered.map((entry) => entry.shortcut).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  }
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
      sync()
      notify()
      return () => {
        const index = registered.findIndex((entry) => entry.token === token)
        if (index === -1) return
        registered.splice(index, 1)
        sync()
        // A sequence that was waiting on this shortcut has nothing left to complete.
        if (pending?.next.includes(shortcut)) setPending(null)
        notify()
      }
    },

    cancel: () => setPending(null),

    focusOut(event) {
      if (pending === null) return
      const next = event.relatedTarget
      if (!(next instanceof Node && document.getElementById("main")?.contains(next))) setPending(null)
    },

    handle(event) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === IME_KEY_CODE) return
      if (!isEnabled() || event.ctrlKey || event.metaKey || event.altKey) return setPending(null)
      const key = normalize(event)
      if (key === null || event.repeat) return
      if (isTypingTarget(event.target) || overlayOpen()) return setPending(null)

      const typed = [...(pending?.typed ?? []), key]
      // Highest precedence first; one entry per pair of keys, so an override hides what it overrides.
      const seen = new Set<string>()
      const candidates = [...snapshot]
        .reverse()
        .filter(
          (shortcut) =>
            shortcut.keys.length >= typed.length &&
            typed.every((typedKey, index) => shortcut.keys[index] === typedKey) &&
            inScope(shortcut.scope ?? "page", event.target),
        )
        .filter((shortcut) => {
          const id = shortcut.keys.join("\n")
          if (seen.has(id)) return false
          seen.add(id)
          return true
        })
      const exact = candidates.find((shortcut) => shortcut.keys.length === typed.length)
      if (exact) {
        event.preventDefault()
        setPending(null)
        exact.run()
        return
      }
      if (candidates.length > 0) {
        event.preventDefault()
        setPending({ typed, next: candidates.reverse() })
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
