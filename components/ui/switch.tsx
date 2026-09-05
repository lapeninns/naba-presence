"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The platform switch. A pill track on the fill grey that turns the vivid
 * accent when on, and a white thumb (`primary-foreground`, white in both
 * themes) that springs across. Default is the 26×16 desktop size; `lg` is
 * the 51×31 touch size. The visible track stays that small, but a
 * transparent box around the root gives every size at least a 24px target.
 */
const switchVariants = cva(
  cn(
    "group/switch relative inline-flex shrink-0 cursor-default items-center rounded-(--np-radius-pill) bg-fill p-0.5 focus-halo select-none",
    "before:absolute before:-inset-x-1 before:-inset-y-1 before:content-['']",
    "transition-[background-color] duration-(--np-duration-fast) ease-spring-snappy",
    "data-checked:bg-(--np-accent-vivid)",
    "data-disabled:pointer-events-none data-disabled:opacity-50"
  ),
  {
    variants: {
      size: {
        default: "h-4 w-[26px]",
        lg: "h-[31px] w-[51px]",
      },
    },
    defaultVariants: { size: "default" },
  }
)

const thumbVariants = cva(
  cn(
    "block rounded-(--np-radius-pill) bg-primary-foreground shadow-(--np-shadow-raised)",
    "transition-transform duration-(--np-duration-standard) ease-spring"
  ),
  {
    variants: {
      size: {
        default: "size-3 data-checked:translate-x-[10px]",
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
