import { nextEnv } from "@skiffr/env/next"
import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { ExtensionTokens } from "@/components/extension-tokens"
import { getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "Extension" }

export default async function ExtensionPage() {
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery(serverOrpc.tokens.list.queryOptions())
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ExtensionTokens apiUrl={nextEnv().API_PUBLIC_URL} />
    </HydrationBoundary>
  )
}
