"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { cn } from "cn"

/**
 * One choice out of a few (status filter, view switch). A radio group underneath: arrow keys move and select,
 * the group is one tab stop. Give the group an `aria-label`. Use `Select` past five options.
 */
function SegmentedControl({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="segmented-control"
      className={cn("inline-flex h-(--control-h) w-fit max-w-full items-stretch rounded-none", className)}
      {...props}
    />
  )
}

function SegmentedControlItem({ className, children, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="segmented-control-item"
      className={cn(
        "relative flex min-w-0 cursor-default items-center justify-center rounded-none border border-input px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors select-none not-first:-ms-px hover:bg-muted hover:text-foreground focus-visible:z-10 data-checked:z-10 data-checked:border-foreground data-checked:bg-muted data-checked:text-foreground data-checked:shadow-[inset_0_0_0_1px_var(--foreground)] data-disabled:cursor-not-allowed data-disabled:opacity-50 forced-colors:forced-color-adjust-none forced-colors:border-[ButtonText] forced-colors:bg-[Canvas] forced-colors:text-[ButtonText] forced-colors:data-checked:border-[Highlight] forced-colors:data-checked:bg-[Highlight] forced-colors:data-checked:text-[HighlightText] forced-colors:data-checked:shadow-none",
        className
      )}
      {...props}
    >
      {children}
    </RadioPrimitive.Root>
  )
}

export { SegmentedControl, SegmentedControlItem }
