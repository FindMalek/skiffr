"use client"

import { digestOf, ErrorPage, ROUTE_ERROR } from "@/components/shell/error-page"

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPage {...ROUTE_ERROR} requestId={digestOf(error)} onRetry={retry} />
}
