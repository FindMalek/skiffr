import { firstName } from "@skiffr/common/utils"
import { Button } from "@skiffr/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { call } from "@/lib/api"

/** A placeholder until the Today page (#154) lands: it shows no numbers, only where the work is. */
export default async function TodayPage() {
  const me = await call((api) => api.me.get())
  return (
    <>
      <PageHeader title="Today" description={`Hello ${firstName(me.name)}.`} />
      <div className="p-4 md:p-6">
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>What to do next will show here</EmptyTitle>
            <EmptyDescription>
              This page is not built yet. Until then, the queue is where you work, and Settings has the extension setup.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap">
            <Button render={<Link href="/queue" />} nativeButton={false}>
              Open the queue
            </Button>
            <Button variant="outline" render={<Link href="/settings/extension" />} nativeButton={false}>
              Set up the extension
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </>
  )
}
