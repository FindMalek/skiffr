"use client"

import "@skiffr/ui/globals.css"
import { cn } from "@skiffr/ui/lib/utils"
import { digestOf, ErrorPage, ROUTE_ERROR } from "@/components/shell/error-page"
import { focusPageTitle } from "@/components/shell/route-focus"
import { fontVariables } from "./fonts"

/** The root layout itself failed, so there is no theme provider: read the stored choice (the page renders in the browser only). */
function prefersDark(): boolean {
  try {
    const stored = localStorage.getItem("theme")
    return stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
  } catch {
    return false
  }
}

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontVariables, "font-sans", prefersDark() && "dark")}
    >
      <head>
        <title>Something went wrong · skiffr</title>
      </head>
      <body className="bg-background text-foreground">
        <main id="main" tabIndex={-1} className="min-h-dvh pt-12 outline-none">
          <ErrorPage
            {...ROUTE_ERROR}
            requestId={digestOf(error)}
            onRetry={() => {
              retry()
              focusPageTitle()
            }}
            branded
          />
        </main>
      </body>
    </html>
  )
}
