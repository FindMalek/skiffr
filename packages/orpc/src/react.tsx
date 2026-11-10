"use client"

import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { createORPCClientUtils } from "./client"

/** Browser client: same-origin `/api/rpc`, which the app's route handler proxies to the api. */
export const { client: browserClient } = createORPCClientUtils({ url: () => `${window.location.origin}/api/rpc` })

export const orpc = createTanstackQueryUtils(browserClient)

/** One QueryClient per browser tab (never shared between server requests). */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  )
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
