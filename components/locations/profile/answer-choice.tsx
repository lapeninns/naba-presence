"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import {
  segmentedItemClassName,
  segmentedTrackClassName,
} from "@/components/ui/segmented-control"
import { cn } from "@/lib/utils"

export type AnswerOption<Value extends string> = {
  readonly value: Value
  readonly label: string
  /** The option shows its state but cannot be chosen (no way to clear). */
  readonly disabled?: boolean
}

/**
 * A Yes / No / Not set answer drawn as the segmented control, with radio
 * semantics: one answer of three, chosen in one tap, with no pop-up per
 * option and no separate "Clear" button. Arrow keys move the answer, as in
 * any radio group. Segments meet the 44px touch floor on coarse pointers.
 *
 * Built from the segmented control's exported recipes (the "same object,
 * different semantics" case they exist for) until the shared TriState
 * primitive lands.
 */
export function AnswerChoice<Value extends string>({
  value,
  options,
  onValueChange,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  readonly value: Value
  readonly options: readonly AnswerOption<Value>[]
  readonly onValueChange: (value: Value) => void
  readonly disabled?: boolean
  readonly className?: string
  readonly "aria-label"?: string
  readonly "aria-labelledby"?: string
  readonly "aria-describedby"?: string
}) {
  return (
    <RadioGroupPrimitive<Value>
      data-slot="answer-choice"
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== value) onValueChange(next)
      }}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={cn(segmentedTrackClassName, "w-full sm:w-auto", className)}
    >
      {options.map((option) => (
        <RadioPrimitive.Root<Value>
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          data-slot="segmented-control-item"
          className={cn(
            segmentedItemClassName,
            "cursor-pointer pointer-coarse:h-(--np-touch)",
            "data-checked:bg-surface data-checked:text-ink data-checked:shadow-np-raised",
            "data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:data-checked:opacity-100"
          )}
        >
          {option.label}
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  )
}
