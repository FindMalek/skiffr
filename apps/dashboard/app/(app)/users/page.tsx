import { errorCode } from "@skiffr/orpc/errors"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PageHeader } from "@/components/page-header"
import { UsersTable } from "@/components/users/users-table"
import { call } from "@/lib/api"

export const metadata: Metadata = { title: "Users" }

export default async function UsersPage() {
  // Not an admin: the page does not exist for you. The not found page, not a crash the monitoring counts as a 5xx (the
  // status stays 200, the shell has already started streaming).
  const { total, users } = await call((api) => api.admin.users()).catch((error: unknown) => {
    if (errorCode(error) === "FORBIDDEN") notFound()
    throw error
  })
  return (
    <>
      <PageHeader
        title="Users"
        description="The newest accounts on this server, newest first. Admins only."
        breadcrumb={[{ label: "Admin" }, { label: "Users" }]}
      />
      <div className="p-4 md:p-6">
        <UsersTable users={users} total={total} />
      </div>
    </>
  )
}
