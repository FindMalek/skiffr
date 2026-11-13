import { buttonVariants } from "@skiffr/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = { title: "Profile" }

export default function ProfilePage() {
  return (
    <div className="max-w-3xl p-4 md:p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>The applicant profile is not editable here yet</EmptyTitle>
          <EmptyDescription>
            Links, work authorization, salary and location will be edited on this page. Your name and picture are under
            Account.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/settings/account" className={buttonVariants({ variant: "outline" })}>
            Open Account
          </Link>
        </EmptyContent>
      </Empty>
    </div>
  )
}
