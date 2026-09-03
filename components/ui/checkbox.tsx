"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // --np-radius-tag is 4px in the new scale, which is exactly right for
        // a size-4 control, so this reads the token rather than a literal.
        "flex size-4 shrink-0 items-center justify-center rounded-(--np-radius-tag) border border-[var(--np-line-strong)] bg-surface transition-colors duration-(--np-duration-fast) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex">
        {props.indeterminate ? (
          <MinusIcon className="size-3" aria-hidden />
        ) : (
          <CheckIcon className="size-3" aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
