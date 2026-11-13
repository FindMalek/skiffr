import { cn } from "cn"
import * as React from "react"

/**
 * A page block: a real `<h2>` (plus one line of description) and its content. Pages are a stack of these, not a
 * stack of cards. `action` sits at the end of the heading row and wraps under it on narrow screens.
 */
function Section({
  className,
  title,
  description,
  action,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  const id = React.useId()
  return (
    <section data-slot="section" aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-4", className)} {...props}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} data-slot="section-title" className="font-heading text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <p data-slot="section-description" className="max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div data-slot="section-action" className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export { Section }
