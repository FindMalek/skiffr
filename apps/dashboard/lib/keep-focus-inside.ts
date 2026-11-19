const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Tab and Shift+Tab go round inside the dialog: the page behind it is not reachable while it is open. */
export function keepFocusInside(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return
  const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.getClientRects().length > 0,
  )
  const first = nodes[0]
  const last = nodes.at(-1)
  if (!first || !last) return
  const active = document.activeElement
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}
