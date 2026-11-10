import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { NotesBoard } from "@/components/notes-board"
import { PageHeader } from "@/components/page-header"
import { getQueryClient, serverOrpc } from "@/lib/api"

export const metadata: Metadata = { title: "Notes" }

/** Prefetched on the server, handed to TanStack Query on the client: no loading flash, no extra round trip. */
export default async function NotesPage() {
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery(serverOrpc.notes.list.queryOptions())
  return (
    <>
      <PageHeader title="Notes" description="The example resource: db → orpc → dashboard. Replace it with yours." />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <NotesBoard />
      </HydrationBoundary>
    </>
  )
}
