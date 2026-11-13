import { Button, buttonVariants } from "@skiffr/ui/components/button"
import { ErrorState } from "@skiffr/ui/components/error-state"
import { cn } from "@skiffr/ui/lib/utils"

/**
 * A whole page that failed or does not exist. The `h1` is for assistive tech and the route-change focus, the visible
 * title is the error box. `onRetry` adds "Try again"; "Go to Today" is always there. It is a plain anchor, a full
 * navigation: a client navigation to `/` from the error page of `/` would keep the failed boundary on screen.
 */
export function ErrorPage({
  heading,
  title,
  description,
  requestId,
  onRetry,
  branded = false,
}: {
  heading: string
  title: string
  description: string
  requestId?: string | null
  onRetry?: () => void
  branded?: boolean
}) {
  return (
    <div className={cn("flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6", branded && "mx-auto")}>
      {branded && (
        <a href="/" className="flex w-fit items-center gap-2 font-heading font-semibold text-base">
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center bg-primary text-primary-foreground text-sm"
          >
            s
          </span>
          skiffr
        </a>
      )}
      <h1 tabIndex={-1} className="sr-only">
        {heading}
      </h1>
      <ErrorState
        title={title}
        description={description}
        requestId={requestId}
        action={
          <div className="flex flex-wrap gap-2">
            {onRetry && <Button onClick={onRetry}>Try again</Button>}
            <a href="/" className={cn(buttonVariants({ variant: onRetry ? "outline" : "default" }))}>
              Go to Today
            </a>
          </div>
        }
      />
    </div>
  )
}

/** The id Next attaches to an error from a server component, to match the server log. A client error has none. */
export function digestOf(error: unknown): string | undefined {
  return error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : undefined
}

export const NOT_FOUND = {
  heading: "Page not found",
  title: "This page does not exist",
  description: "The link may be old or mistyped. Today is the place to start from.",
}

export const ROUTE_ERROR = {
  heading: "Something went wrong",
  title: "This page could not load",
  description: "It is on our side, not yours, and nothing you did was lost. Try again, or go back to Today.",
}
