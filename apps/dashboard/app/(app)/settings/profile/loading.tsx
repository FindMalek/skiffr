import { Skeleton } from "@skiffr/ui/components/skeleton"

export default function Loading() {
  return (
    <div className="flex max-w-4xl flex-col gap-8 p-4 md:p-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3 w-full max-w-md" />
      </div>
      {[0, 1, 2].map((group) => (
        <div key={group} className="flex flex-col gap-4 border-b pb-8 @3xl:flex-row @3xl:gap-12">
          <Skeleton className="h-5 w-40 @3xl:w-60 @3xl:shrink-0" />
          <div className="flex flex-1 flex-col gap-5 @3xl:max-w-120">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
