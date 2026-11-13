"use client"

import { digestOf, ErrorPage, ROUTE_ERROR } from "@/components/shell/error-page"

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="min-h-dvh pt-12 outline-none">
      <ErrorPage {...ROUTE_ERROR} requestId={digestOf(error)} onRetry={retry} branded />
    </main>
  )
}
