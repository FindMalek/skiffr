export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col">
      <div className="flex flex-col gap-3 border-b px-4 pt-6 pb-6 md:px-6">
        <div className="h-8 w-48 bg-border" />
        <div className="h-5 w-full max-w-prose bg-border" />
      </div>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="h-24 bg-border" />
        <div className="h-64 bg-border" />
      </div>
      <p role="status" className="sr-only">
        Loading
      </p>
    </div>
  )
}
