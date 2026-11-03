"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import * as React from "react"

import {
  selectionHitAreaClassName,
  selectionRowClassName,
} from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/**
 * A group of radio buttons. Arrow keys move the selection; the group is
 * announced with the `aria-label` (or `aria-labelledby`) you give it.
 */
function RadioGroup<Value>({
  className,
  ...props
}: RadioGroupPrimitive.Props<Value>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

/**
 * The 18px ring (reference `.radio`): selected, the ring thickens to 5px
 * accent. Positioned, so a caller can hang a hit area on it; the bare ring
 * has none (ChoiceCard and labelled radios are targets already). Disabled
 * is drawn, never faded: the ring sinks to the disabled fill and edge, and a
 * selected one keeps its thick ring in the disabled ink, so it still reads
 * as the choice.
 */
export const radioClassName = cn(
  "relative flex size-(--np-selection-box) shrink-0 items-center justify-center rounded-(--np-radius-pill) border-[1.5px] border-line-strong bg-(--np-field-bg) focus-halo",
  "transition-[border-color,border-width] duration-(--np-duration-fast) ease-press",
  "data-checked:border-[5px] data-checked:border-primary",
  "data-disabled:cursor-not-allowed data-disabled:border-disabled-line data-disabled:bg-disabled data-disabled:data-checked:border-disabled-ink",
  "aria-invalid:border-danger-ink"
)

/**
 * One radio. Children become the label, wrapped in a native `<label>` so
 * clicking the text selects the radio. `description` adds the caption line
 * beneath the label. Without children, give the radio an `aria-label`.
 */
function RadioGroupItem<Value>({
  className,
  children,
  labelClassName,
  description,
  ...props
}: RadioPrimitive.Root.Props<Value> & {
  labelClassName?: string
  description?: React.ReactNode
}) {
  const id = React.useId()
  const hasLabel = children !== undefined && children !== null
  const radio = (
    <RadioPrimitive.Root
      data-slot="radio"
      // A `span role="radio"` is not named by its wrapping <label>.
      aria-labelledby={hasLabel ? `${id}-label` : undefined}
      aria-describedby={description ? `${id}-desc` : undefined}
      className={cn(
        radioClassName,
        // An unlabelled radio gets the same 44px-on-touch hit area as an
        // unlabelled checkbox; a labelled one is reached through its row.
        hasLabel
          ? "after:absolute after:inset-[calc((100%-var(--np-touch-min))/2)] after:content-['']"
          : selectionHitAreaClassName,
        className
      )}
      {...props}
    />
  )

  if (!hasLabel) return radio

  return (
    <label
      data-slot="radio-label"
      className={cn(
        selectionRowClassName,
        "[&>[data-slot=radio]]:mt-(--np-selection-offset)",
        labelClassName
      )}
    >
      {radio}
      <span className="min-w-0">
        <span id={`${id}-label`}>{children}</span>
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

export { RadioGroup, RadioGroupItem }
