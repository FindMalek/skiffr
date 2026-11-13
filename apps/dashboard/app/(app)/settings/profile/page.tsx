import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { ProfileSettings } from "@/components/profile/profile-editor"
import { getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "Profile" }

export default async function ProfilePage() {
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery(serverOrpc.profile.get.queryOptions())
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProfileSettings />
    </HydrationBoundary>
  )
}
