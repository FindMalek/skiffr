import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { CheckIcon, CircleCheckIcon, CircleIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react"
import type * as React from "react"

const statusBadgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-none border px-2 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-border-strong text-foreground",
        strong: "border-foreground bg-foreground text-background",
        success: "border-success text-foreground [&>svg]:text-success",
        warning: "border-warning text-foreground [&>svg]:text-warning",
        danger: "border-destructive text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>["tone"]>

const TONE_ICON: Record<StatusTone, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  neutral: CircleIcon,
  strong: CheckIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  danger: CircleXIcon,
}

/**
 * One badge per entity. The word is always visible and the tone is never the only signal: every tone has its own
 * icon. `strong` (filled) always means "done and kept"; status colour is an outline and an icon, never a fill.
 * Source and ATS labels are not status: use muted mono text.
 */
function StatusBadge({
  className,
  tone = "neutral",
  icon,
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants> & { icon?: React.ReactNode }) {
  const Icon = TONE_ICON[tone ?? "neutral"]
  return (
    <span data-slot="status-badge" data-tone={tone} className={cn(statusBadgeVariants({ tone }), className)} {...props}>
      {icon ? <span aria-hidden="true" className="inline-flex">{icon}</span> : <Icon aria-hidden="true" />}
      {children}
    </span>
  )
}

export { StatusBadge, statusBadgeVariants }
export type { StatusTone }
