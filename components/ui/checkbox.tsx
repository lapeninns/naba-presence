"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The tappable area of an 18px box or ring when it stands alone (a table's
 * selection column, a row's leading check). The drawn mark stays 18px — a
 * 44px box would shout in a dense list — but a transparent pseudo-element
 * centred on it reaches `--np-touch` (44px) on a phone and steps back to the
 * 24px minimum at the desk, where a mouse is precise and a 44px halo would
 * swallow clicks meant for the neighbouring cell.
 */
export const selectionHitAreaClassName = cn(
  "after:absolute after:inset-[calc((var(--np-selection-box)-var(--np-touch))/2)] after:content-['']",
  "desk:after:inset-[calc((var(--np-selection-box)-var(--np-touch-min))/2)]"
)

/**
 * The same control with its words: the whole row is a native `<label>`, so
 * the label and description are the target, and on a phone the row is at
 * least 44px tall (10px above and below a 24px line). The box's own halo
 * shrinks back to 24px here — the row already is the target, and a 44px halo
 * would reach into the row above.
 *
 * Disabled is drawn once: the control fades, the words turn muted. Fading
 * the row as well multiplied the two (0.5 × 0.6 = 0.3) and left the label
 * unreadable.
 */
export const selectionRowClassName = cn(
  "flex min-h-(--np-touch) cursor-pointer items-start gap-2.5 py-2.5 text-body text-ink select-none",
  "desk:min-h-6 desk:py-0",
  "has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-ink-muted"
)

/**
 * Reference `.check`: an 18px box, 5px radius, a 1.5px `line-strong` edge on
 * the surface; checked or indeterminate it fills with the accent solid and
 * draws the mark in the on-accent ink.
 *
 * Optional `label` and `description` wrap the box in a native `<label>` so
 * the words are the click target and the accessible name (reference
 * `.check .desc`). Without them, name the box with `aria-label` as before —
 * it still gets a 44px hit area on touch (`selectionHitAreaClassName`), so a
 * selection column needs no wrapper of its own.
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
        "relative flex size-(--np-selection-box) shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-line-strong bg-(--np-field-bg) text-primary-foreground focus-halo",
        "transition-[background-color,border-color] duration-(--np-duration-fast) ease-spring-snappy",
        hasLabel
          ? "after:absolute after:inset-[calc((var(--np-selection-box)-var(--np-touch-min))/2)] after:content-['']"
          : selectionHitAreaClassName,
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
        selectionRowClassName,
        "[&>[data-slot=checkbox]]:mt-(--np-selection-offset)",
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
