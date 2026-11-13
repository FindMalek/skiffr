"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "cn"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-none border border-input px-[3px] transition-colors after:absolute after:-inset-2 coarse:after:-inset-3 aria-invalid:border-destructive data-[size=default]:h-6 data-[size=default]:w-11 data-[size=sm]:h-5 data-[size=sm]:w-9 data-checked:border-primary data-checked:bg-primary data-unchecked:bg-transparent data-disabled:cursor-not-allowed data-disabled:opacity-50 forced-colors:border-[ButtonText] forced-colors:data-checked:border-[Highlight] forced-colors:data-checked:bg-[Highlight]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-none transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-5 group-data-[size=sm]/switch:data-checked:translate-x-4 group-data-[size=default]/switch:rtl:data-checked:-translate-x-5 group-data-[size=sm]/switch:rtl:data-checked:-translate-x-4 data-checked:bg-primary-foreground data-unchecked:translate-x-0 data-unchecked:bg-border-strong forced-colors:data-unchecked:bg-[ButtonText] forced-colors:data-checked:bg-[HighlightText]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
