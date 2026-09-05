"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A 16px box on the tag radius. Off: field background with the `line-strong`
 * edge. On: accent fill with a white check that springs in. The edge is a
 * real 1px border here rather than the half-pixel field hairline — at 16px a
 * half-pixel edge disappears on a non-retina display.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-(--np-radius-tag) border border-line-strong bg-(--np-field-bg) text-primary-foreground focus-halo",
        "transition-[background-color,border-color,transform] duration-(--np-duration-fast) ease-spring-snappy active:scale-[0.96]",
        "data-indeterminate:border-primary data-indeterminate:bg-primary data-checked:border-primary data-checked:bg-primary",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "aria-invalid:border-(--np-danger-line)",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className={cn(
          "flex transition-[transform,opacity] duration-(--np-duration-fast) ease-spring",
          "data-ending-style:scale-50 data-ending-style:opacity-0 data-starting-style:scale-50 data-starting-style:opacity-0"
        )}
      >
        {props.indeterminate ? (
          <MinusIcon className="size-3" strokeWidth={2.5} aria-hidden />
        ) : (
          <CheckIcon className="size-3" strokeWidth={2.5} aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
