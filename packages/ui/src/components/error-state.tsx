import { cn } from "cn"
import { CircleXIcon } from "lucide-react"
import type * as React from "react"

/**
 * A section or route that failed: what failed in plain words, the reason when known, one way out (`action`, usually
 * a "Try again" button) and the request id so it can be reported. Never a bare red text line. No retry logic here.
 */
function ErrorState({
  className,
  title,
  description,
  requestId,
  action,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  requestId?: string | null
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn("flex w-full min-w-0 items-start gap-3 rounded-none border border-destructive p-4 text-sm sm:p-6", className)}
      {...props}
    >
      <CircleXIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <div className="flex max-w-prose flex-col gap-1">
          <p data-slot="error-state-title" className="font-heading text-base font-semibold">
            {title}
          </p>
          {description ? <p className="text-muted-foreground">{description}</p> : null}
          {requestId ? (
            <p className="font-mono text-xs break-all text-muted-foreground">Request id: {requestId}</p>
          ) : null}
        </div>
        {action}
      </div>
    </div>
  )
}

export { ErrorState }
