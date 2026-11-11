import { cn } from "@skiffr/ui/lib/utils"
import { clip, displayText, revealInvisible } from "@/lib/answers"

const TITLE_MAX = 1_000

/**
 * Text that came from a web page. Only ever a React text child: never markup, a link, a style or a url.
 * `dir="auto"` isolates it, so Arabic or Hebrew reads right and cannot reorder the text around it.
 */
export function SafeText({
  text,
  max = 240,
  lines = 2,
  className,
}: {
  text: string
  max?: number
  lines?: 1 | 2 | 3
  className?: string
}) {
  if (text === "") return <span className={cn("text-muted-foreground italic", className)}>(empty)</span>
  const shown = displayText(text, max)
  const changed = shown.clipped || shown.text !== text
  return (
    <span
      dir="auto"
      title={changed || text.length > 30 ? clip(revealInvisible(text), TITLE_MAX).text : undefined}
      className={cn(
        "block min-w-0 overflow-hidden whitespace-pre-line [overflow-wrap:anywhere]",
        lines === 1 ? "line-clamp-1" : lines === 2 ? "line-clamp-2" : "line-clamp-3",
        className,
      )}
    >
      {shown.text}
      {shown.clipped ? "…" : ""}
    </span>
  )
}

/** A short piece of a label for an aria-label or a dialog title. */
export function plainLabel(text: string, max = 60): string {
  const shown = displayText(text.replace(/\s+/g, " ").trim(), max)
  return shown.clipped ? `${shown.text}…` : shown.text
}
