import "server-only"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import type { AppRouterClient } from "@skiffr/orpc/client"
import { isUnauthorized } from "@skiffr/orpc/errors"
import { createServerClient } from "@skiffr/orpc/server"
import { QueryClient } from "@tanstack/react-query"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

/** Server calls carry the visitor's cookie (and the csrf header the link adds), straight to the api service. */
const api = createServerClient(async () => ({ cookie: (await cookies()).toString() }))

/** Same keys as the browser's `orpc` utils, so what the server prefetches hydrates the client cache. */
export const serverOrpc = createTanstackQueryUtils(api)

/** One QueryClient per request, shared by every server component that prefetches into it. */
export const getQueryClient = cache(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }))

/** A direct call for server components; an expired session goes back to sign-in. */
export async function call<T>(fn: (client: AppRouterClient) => Promise<T>): Promise<T> {
  try {
    return await fn(api)
  } catch (error) {
    if (isUnauthorized(error)) redirect("/sign-in")
    throw error
  }
}
