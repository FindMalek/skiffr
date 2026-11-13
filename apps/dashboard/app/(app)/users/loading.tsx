import { PageHeader } from "@/components/page-header"

/** Same blocks as the page: search, the table (header and 10 rows) or the 10 stacked rows below md, the pager. */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Users"
        description="Every account on this server, newest first. Admins only."
        breadcrumb={[{ label: "Admin" }, { label: "Users" }]}
      />
      <div aria-busy="true" className="flex flex-col gap-4 p-4 md:p-6">
        <div className="h-8 w-full max-w-md bg-muted" />
        <div className="flex flex-col border-y">
          <div className="hidden h-10 border-b md:block" />
          {Array.from({ length: 10 }, (_, row) => (
            <div key={row} className="h-32 border-b bg-muted/40 last:border-b-0 md:h-16" />
          ))}
        </div>
        <div className="h-8" />
        <p role="status" className="sr-only">
          Loading
        </p>
      </div>
    </>
  )
}
