"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The segmented control: one of N views of the same data. Built on Base UI
 * Tabs so it gets the tablist keyboard model for free — the selected segment
 * is the tab stop, Left/Right (Home/End) move and select, and a `TabsPanel`
 * can be attached by value where a real panel exists.
 *
 * The track is the fill grey with 2px padding; the selected segment is a
 * white thumb (`Tabs.Indicator`) carrying the raised shadow that slides on
 * the snappy spring. Thumb and segment radii are the track radius minus the
 * padding, so the corners stay concentric.
 */
const trackVariants = cva(
  "relative isolate flex w-full min-w-0 items-center gap-0.5 rounded-(--np-radius-control) bg-fill p-0.5",
  {
    variants: {
      size: {
        sm: "h-7",
        default: "h-(--np-control-h)",
      },
    },
    defaultVariants: { size: "default" },
  }
)

export type SegmentedControlProps = Omit<
  TabsPrimitive.Root.Props,
  "value" | "defaultValue" | "onValueChange"
> &
  VariantProps<typeof trackVariants> & {
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
    /** Reaches the inner tablist, which is the visible track. */
    trackClassName?: string
    "aria-label"?: string
    "aria-labelledby"?: string
  }

function SegmentedControl({
  className,
  trackClassName,
  size,
  value,
  defaultValue,
  onValueChange,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: SegmentedControlProps) {
  return (
    <TabsPrimitive.Root
      data-slot="segmented-control"
      className={cn("inline-flex max-w-full", className)}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange?.(next)
      }}
      {...props}
    >
      <TabsPrimitive.List
        data-slot="segmented-control-track"
        activateOnFocus
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(trackVariants({ size }), trackClassName)}
      >
        {children}
        <TabsPrimitive.Indicator
          data-slot="segmented-control-thumb"
          aria-hidden
          className={cn(
            "absolute top-0 left-0 z-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top)",
            "rounded-[calc(var(--np-radius-control)-2px)] bg-surface shadow-(--np-shadow-raised)",
            "transition-[transform,width,height] duration-(--np-duration-standard) ease-spring-snappy"
          )}
        />
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

export type SegmentedControlItemProps = Omit<
  TabsPrimitive.Tab.Props,
  "value"
> & {
  value: string
}

function SegmentedControlItem({
  className,
  ...props
}: SegmentedControlItemProps) {
  return (
    <TabsPrimitive.Tab
      data-slot="segmented-control-item"
      className={cn(
        "relative z-10 inline-flex h-full min-w-0 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-[calc(var(--np-radius-control)-2px)] px-3 text-ui font-medium whitespace-nowrap text-ink-muted focus-halo select-none",
        "transition-[color,transform] duration-(--np-duration-fast) ease-spring-snappy",
        "hover:text-ink active:scale-[0.98] data-selected:text-ink",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

export { SegmentedControl, SegmentedControlItem }
