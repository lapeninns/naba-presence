"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // No 4px --nr-radius-* step is defined (the smallest is
        // --nr-radius-tag at 6px, too large for a size-4 control), so this
        // stays a literal value rather than a mismatched token.
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border bg-card transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex">
        <CheckIcon className="size-3" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
