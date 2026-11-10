"use client"

/**
 * A date in the viewer's own locale and timezone. The server can't know either, so the text may differ from the
 * server render; suppressHydrationWarning accepts that for this one node.
 */
export function LocalDate({ value, time = false }: { value: Date; time?: boolean }) {
  return (
    <time dateTime={value.toISOString()} suppressHydrationWarning>
      {time ? value.toLocaleString() : value.toLocaleDateString()}
    </time>
  )
}
