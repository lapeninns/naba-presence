"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Reference `.switch`: a 36×20 track in the control-edge grey that turns the
 * accent solid when on, and a 16px surface thumb with the raised shadow that
 * slides 16px. `lg` is the 51×31 touch size. A transparent box around the
 * root gives the default size a 24px+ target (44px on coarse pointers).
 * Use only for a truly boolean value; if "not set" is a real state, use a
 * radio group or segmented control instead.
 */
const switchVariants = cva(
  cn(
    "group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-(--np-radius-pill) bg-line-strong p-0.5 focus-halo select-none",
    "before:absolute before:-inset-x-1 before:-inset-y-1 before:content-[''] pointer-coarse:before:-inset-y-3",
    "transition-[background-color] duration-(--np-duration-fast) ease-spring-snappy",
    "data-checked:bg-primary",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50"
  ),
  {
    variants: {
      size: {
        default: "h-5 w-9",
        lg: "h-[31px] w-[51px]",
      },
    },
    defaultVariants: { size: "default" },
  }
)

const thumbVariants = cva(
  cn(
    "block rounded-(--np-radius-pill) bg-surface shadow-np-raised",
    "transition-transform duration-(--np-duration-fast) ease-spring"
  ),
  {
    variants: {
      size: {
        default: "size-4 data-checked:translate-x-4",
        lg: "size-[27px] data-checked:translate-x-[20px]",
      },
    },
    defaultVariants: { size: "default" },
  }
)

export type SwitchProps = SwitchPrimitive.Root.Props &
  VariantProps<typeof switchVariants>

function Switch({ className, size, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(switchVariants({ size }), className)}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={thumbVariants({ size })}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch, switchVariants }
