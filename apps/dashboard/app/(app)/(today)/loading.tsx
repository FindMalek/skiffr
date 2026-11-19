import { PageHeader } from "@/components/page-header"
import { TodaySkeleton } from "@/components/today/today-view"

export default function Loading() {
  return (
    <>
      <PageHeader title="Today" description="What to do next." />
      <TodaySkeleton />
      <p role="status" className="sr-only">
        Loading
      </p>
    </>
  )
}
