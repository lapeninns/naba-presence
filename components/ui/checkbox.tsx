"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Reference `.check`: an 18px box, 5px radius, a 1.5px `line-strong` edge on
 * the surface; checked or indeterminate it fills with the accent solid and
 * draws the mark in the on-accent ink.
 *
 * Optional `label` and `description` wrap the box in a native `<label>` so
 * the words are the click target and the accessible name (reference
 * `.check .desc`). Without them, name the box with `aria-label` as before.
 */
function Checkbox({
  className,
  label,
  description,
  labelClassName,
  ...props
}: CheckboxPrimitive.Root.Props & {
  label?: React.ReactNode
  description?: React.ReactNode
  labelClassName?: string
}) {
  const id = React.useId()
  const hasLabel = label !== undefined && label !== null
  const box = (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      // The root is a `span role="checkbox"`, which a wrapping <label> does
      // not name; point it at the words explicitly.
      aria-labelledby={hasLabel ? `${id}-label` : undefined}
      aria-describedby={description ? `${id}-desc` : undefined}
      className={cn(
        "relative flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-line-strong bg-(--np-field-bg) text-primary-foreground focus-halo",
        "transition-[background-color,border-color] duration-(--np-duration-fast) ease-spring-snappy",
        "after:absolute after:-inset-[3px] after:content-['']",
        "data-indeterminate:border-primary data-indeterminate:bg-primary data-checked:border-primary data-checked:bg-primary",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "aria-invalid:border-danger-ink",
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
          <MinusIcon className="size-3" strokeWidth={3} aria-hidden />
        ) : (
          <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )

  if (!hasLabel) return box

  return (
    <label
      data-slot="checkbox-label"
      className={cn(
        "flex min-h-6 cursor-pointer items-start gap-2.5 text-body text-ink has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60 [&>[data-slot=checkbox]]:mt-0.5",
        labelClassName
      )}
    >
      {box}
      <span className="min-w-0">
        <span id={`${id}-label`}>{label}</span>
        {description ? (
          <span
            id={`${id}-desc`}
            className="mt-0.5 block text-caption text-ink-muted"
          >
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export { Checkbox }
