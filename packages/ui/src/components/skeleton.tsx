import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-skeleton rounded-none bg-border", className)}
      {...props}
    />
  )
}

export { Skeleton }
