"use client"

import { digestOf, ErrorPage, ROUTE_ERROR } from "@/components/shell/error-page"
import { focusPageTitle } from "@/components/shell/route-focus"

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorPage
      {...ROUTE_ERROR}
      requestId={digestOf(error)}
      onRetry={() => {
        retry()
        focusPageTitle()
      }}
    />
  )
}
