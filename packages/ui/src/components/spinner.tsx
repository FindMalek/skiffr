"use client"

import { cn } from "cn"
import { Loader2Icon } from "lucide-react"

/**
 * Always pair it with a visible text label ("Saving..."): under reduced motion the icon is static, the label is the cue.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
