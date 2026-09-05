"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

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
 * One radio: a 16px circle on the field background with the `line-strong`
 * edge; selected, the edge turns accent and an accent dot springs in.
 * Children become the label, wrapped in a native `<label>` so clicking the
 * text selects the radio and Base UI wires `aria-labelledby` automatically.
 * Without children, give the radio an `aria-label`.
 */
function RadioGroupItem<Value>({
  className,
  children,
  labelClassName,
  ...props
}: RadioPrimitive.Root.Props<Value> & { labelClassName?: string }) {
  const radio = (
    <RadioPrimitive.Root
      data-slot="radio"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-(--np-radius-pill) border border-line-strong bg-(--np-field-bg) focus-halo",
        "transition-[border-color,background-color,transform] duration-(--np-duration-fast) ease-spring-snappy active:scale-[0.96]",
        "data-checked:border-primary",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "aria-invalid:border-(--np-danger-line)",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-indicator"
        className={cn(
          "block size-2 rounded-(--np-radius-pill) bg-primary",
          "transition-[transform,opacity] duration-(--np-duration-fast) ease-spring",
          "data-ending-style:scale-50 data-ending-style:opacity-0 data-starting-style:scale-50 data-starting-style:opacity-0"
        )}
      />
    </RadioPrimitive.Root>
  )

  if (children === undefined || children === null) return radio

  return (
    <label
      data-slot="radio-label"
      className={cn(
        "flex cursor-default items-center gap-2 text-ui text-ink select-none has-[[data-disabled]]:opacity-50",
        labelClassName
      )}
    >
      {radio}
      <span className="min-w-0">{children}</span>
    </label>
  )
}

export { RadioGroup, RadioGroupItem }
