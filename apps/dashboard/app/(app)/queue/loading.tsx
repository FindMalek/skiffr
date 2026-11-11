import { PageHeader } from "@/components/page-header"
import { QueueSkeleton } from "@/components/queue/queue-board"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Queue"
        description="Jobs you want to apply to. Work through them in order, you always press submit yourself."
      />
      <div className="grid grid-cols-1 gap-4 p-4 md:p-6">
        <div className="h-40 animate-pulse bg-muted" />
        <QueueSkeleton />
      </div>
    </>
  )
}
