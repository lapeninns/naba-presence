"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/**
 * Wrap a region (or the app) once. Tooltips inside share one short delay,
 * and once one is showing its neighbours open instantly, the way the
 * platform's toolbar tips do.
 */
function TooltipProvider({
  delay = 300,
  closeDelay = 100,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} {...props} />
  )
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

type PositionProps = Pick<
  TooltipPrimitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset"
>

/**
 * A small charcoal label (the counter-surface, like toasts): caption text in
 * the on-charcoal ink, control radius. In the dark theme charcoal is
 * near-white with dark text. Never the only home of information a touch
 * user needs; a tooltip does not open on touch.
 */
function TooltipContent({
  className,
  children,
  side = "top",
  align = "center",
  sideOffset = 6,
  alignOffset,
  ...props
}: TooltipPrimitive.Popup.Props & PositionProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "max-w-xs origin-(--transform-origin) rounded-(--np-radius-control) bg-charcoal px-2 py-1 text-caption font-medium text-balance text-ink-on-charcoal shadow-np-pop outline-none",
            "transition-[opacity,scale] duration-(--np-duration-fast) ease-spring data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-instant:duration-0",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent }
