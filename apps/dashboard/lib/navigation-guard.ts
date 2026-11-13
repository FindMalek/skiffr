type Holder = (href: string) => boolean

let holder: Holder | null = null

/** A page with unsaved edits registers a holder: it takes the address and returns false to stop the navigation. Returns the undo. */
export function holdNavigation(next: Holder): () => void {
  holder = next
  return () => {
    if (holder === next) holder = null
  }
}

/** For code that calls `router.push` itself (a select, a button): ask first, go only when this is true. */
export const mayNavigate = (href: string): boolean => holder?.(href) ?? true
