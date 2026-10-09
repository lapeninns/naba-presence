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
 * Reference `.segmented`: a hover-fill track with 3px padding and a 10px
 * radius; 30px segments (40px on coarse pointers) in the strong secondary
 * ink; the selected segment is drawn as a white thumb with the raised
 * shadow (styled on the segment itself, so it never depends on a measured
 * indicator). A long track scrolls sideways inside itself.
 */
/**
 * The three recipes the control is made of, exported so a surface that needs
 * different SEMANTICS — sign-in's two `aria-pressed` buttons, which are one
 * form in two shapes rather than two panels — can still be the same OBJECT.
 * Copying the strings instead is how a track on one screen quietly stops
 * matching the track on the next.
 */
const segmentedThumbClassName = cn(
  "rounded-[7px] bg-surface shadow-np-raised"
)

const segmentedItemClassName = cn(
  "relative z-10 inline-flex h-[30px] min-w-0 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-[7px] px-3 text-ui font-medium whitespace-nowrap text-ink-secondary focus-halo select-none pointer-coarse:h-10",
  "transition-[color,background-color] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:text-ink aria-pressed:text-ink data-active:text-ink",
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
)

const trackVariants = cva(
  "relative isolate flex w-full max-w-full min-w-0 items-center gap-0.5 overflow-x-auto rounded-[10px] bg-fill p-[3px] [scrollbar-width:none]",
  {
    variants: {
      size: {
        sm: "[&_[data-slot=segmented-control-item]]:h-6 pointer-coarse:[&_[data-slot=segmented-control-item]]:h-10",
        default: "",
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
        segmentedItemClassName,
        "data-active:bg-surface data-active:text-ink data-active:shadow-np-raised",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

/** The visible track: the hover-fill grey with 3px of padding. */
const segmentedTrackClassName = trackVariants({ size: "default" })

export {
  SegmentedControl,
  SegmentedControlItem,
  segmentedItemClassName,
  segmentedThumbClassName,
  segmentedTrackClassName,
}
